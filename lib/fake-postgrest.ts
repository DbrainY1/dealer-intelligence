// A small in-memory stand-in for the PostgREST subset the dashboard uses.
//
// It exists so the previous per-dealer loader and the new set-based loader can
// be run over byte-identical fixtures and their outputs compared. It
// deliberately reproduces the behavior that made the old code wrong:
//
//   - every response is capped at MAX_ROWS (1,000 on this project), so an
//     unpaged read silently truncates exactly as production does;
//   - `{ count: "exact" }` still reports the true total even when the returned
//     rows are capped, which is why some old call sites were correct and
//     others — the ones reading `.length` — were not.
//
// Test-support only; not imported by application code.

export const MAX_ROWS = 1000;

type Row = Record<string, unknown>;

interface Filter {
  kind: "eq" | "in" | "gte" | "lte" | "lt" | "isNull" | "notNull";
  col: string;
  value?: unknown;
}

export interface FakeTables {
  [table: string]: Row[];
}

export class FakePostgrest {
  readonly tables: FakeTables;
  /** Every query issued, in order — the basis for the query-count assertions. */
  readonly log: string[] = [];

  constructor(tables: FakeTables) {
    this.tables = tables;
  }

  get queryCount(): number {
    return this.log.length;
  }

  reset() {
    this.log.length = 0;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private cols = "*";
  private wantCount = false;
  private headOnly = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  private db: FakePostgrest;
  private table: string;

  // Explicit assignment rather than parameter properties: `node
  // --experimental-strip-types` runs in strip-only mode and rejects those.
  constructor(db: FakePostgrest, table: string) {
    this.db = db;
    this.table = table;
  }

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.cols = cols;
    this.wantCount = opts?.count === "exact";
    this.headOnly = opts?.head === true;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ kind: "eq", col, value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ kind: "in", col, value });
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push({ kind: "gte", col, value });
    return this;
  }
  lte(col: string, value: unknown) {
    this.filters.push({ kind: "lte", col, value });
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push({ kind: "lt", col, value });
    return this;
  }
  is(col: string, value: unknown) {
    if (value === null) this.filters.push({ kind: "isNull", col });
    return this;
  }
  not(col: string, op: string, value: unknown) {
    if (op === "is" && value === null) this.filters.push({ kind: "notNull", col });
    return this;
  }
  or() {
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  private matching(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      rows = rows.filter((r) => {
        const v = r[f.col];
        switch (f.kind) {
          case "eq":
            return v === f.value;
          case "in":
            return (f.value as unknown[]).includes(v);
          case "gte":
            return v != null && (v as string | number) >= (f.value as string | number);
          case "lte":
            return v != null && (v as string | number) <= (f.value as string | number);
          case "lt":
            return v != null && (v as string | number) < (f.value as string | number);
          case "isNull":
            return v == null;
          case "notNull":
            return v != null;
        }
      });
    }
    for (const o of [...this.orderBy].reverse()) {
      rows.sort((a, b) => {
        const x = a[o.col] as string | number;
        const y = b[o.col] as string | number;
        if (x === y) return 0;
        return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
      });
    }
    return rows;
  }

  private project(rows: Row[]): Row[] {
    if (this.cols === "*") return rows.map((r) => ({ ...r }));
    const keys = this.cols.split(",").map((c) => c.trim()).filter(Boolean);
    return rows.map((r) => {
      const out: Row = {};
      for (const k of keys) out[k] = r[k];
      return out;
    });
  }

  /** Applies the server row cap and any explicit range window. */
  private window(rows: Row[]): Row[] {
    if (this.limitN != null) return rows.slice(0, Math.min(this.limitN, MAX_ROWS));
    if (this.rangeFrom != null && this.rangeTo != null) {
      const want = this.rangeTo - this.rangeFrom + 1;
      return rows.slice(this.rangeFrom, this.rangeFrom + Math.min(want, MAX_ROWS));
    }
    return rows.slice(0, MAX_ROWS);
  }

  private run() {
    this.db.log.push(`${this.table}:${this.cols}`);
    const all = this.matching();
    const count = this.wantCount ? all.length : null;
    if (this.headOnly) return { data: null, error: null, count };
    return { data: this.project(this.window(all)), error: null, count };
  }

  async maybeSingle() {
    const { data, count } = this.run();
    return { data: (data && data[0]) ?? null, error: null, count };
  }

  async single() {
    const { data, count } = this.run();
    const row = (data && data[0]) ?? null;
    return row == null
      ? { data: null, error: { message: "no rows" }, count }
      : { data: row, error: null, count };
  }

  then<R1 = { data: Row[] | null; error: null; count: number | null }, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | null; error: null; count: number | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
