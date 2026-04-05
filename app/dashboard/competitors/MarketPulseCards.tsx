"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PriceSparkline from "@/components/PriceSparkline";

export interface ScorecardRow {
  id: number;
  name: string;
  count: number;
  sold: number;
  added: number | null;
  removed: number | null;
}

function SortableCard({
  row,
  isSelected,
  onToggle,
}: {
  row: ScorecardRow;
  isSelected: boolean;
  onToggle: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-gray-900 rounded-lg overflow-hidden transition-all ${
        isSelected ? "border-2 border-blue-500" : "border-2 border-gray-800 opacity-50"
      }`}
    >
      {/* Drag handle + name header */}
      <div
        className={`px-3 py-2 flex items-center gap-2 ${isSelected ? "bg-gray-700" : "bg-gray-800"}`}
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing text-xs select-none"
          title="Drag to reorder"
        >
          ⠿
        </span>
        {/* Name — click to select/deselect */}
        <p
          className="text-white font-bold text-sm truncate flex-1 cursor-pointer"
          onClick={() => onToggle(row.id)}
        >
          {row.name}
        </p>
      </div>

      {/* Stats — click to select/deselect */}
      <div className="p-3 space-y-2 cursor-pointer" onClick={() => onToggle(row.id)}>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-2xl font-bold text-blue-400">{row.count.toLocaleString()}</p>
            <p className="text-gray-500 text-xs">in stock</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-400">{row.sold}</p>
            <p className="text-gray-500 text-xs">MTD sold</p>
          </div>
        </div>

        {/* Price Sparkline — 7-day trend */}
        <div className="my-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-gray-500 mb-1">7-day avg price</p>
          <PriceSparkline dealerId={row.id} />
        </div>

        <div className="flex justify-between border-t border-gray-800 pt-2 text-xs">
          <div className="flex items-center gap-1">
            {row.added === null
              ? <span className="text-gray-500 font-semibold">N/A</span>
              : <span className="text-green-300 font-semibold">↑ {row.added}</span>}
            <span className="text-gray-500">added</span>
          </div>
          <div className="flex items-center gap-1">
            {row.removed === null
              ? <span className="text-gray-500 font-semibold">N/A</span>
              : <span className="text-red-300 font-semibold">↓ {row.removed}</span>}
            <span className="text-gray-500">removed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const STORAGE_KEY = "market-pulse-order";

export default function MarketPulseCards({ scorecards }: { scorecards: ScorecardRow[] }) {
  const allIds = scorecards.map((s) => s.id);
  const [selected, setSelected] = useState<Set<number>>(new Set(allIds));
  const [order, setOrder] = useState<number[]>(allIds);

  // Load saved order from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: number[] = JSON.parse(saved);
        // Only use saved order if it contains the same IDs
        const savedSet = new Set(parsed);
        const allSet = new Set(allIds);
        const isValid =
          parsed.length === allIds.length &&
          allIds.every((id) => savedSet.has(id)) &&
          parsed.every((id) => allSet.has(id));
        if (isValid) setOrder(parsed);
      }
    } catch {}
  }, []);

  const sorted = order.map((id) => scorecards.find((s) => s.id === id)!).filter(Boolean);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(allIds));
  const clear = () => setSelected(new Set());

  const exportCSV = () => {
    const rows = sorted.filter((s) => selected.has(s.id));
    const header = "Dealer,In Stock,MTD Sold,Added This Week,Removed This Week";
    const lines = rows.map((s) => `${s.name},${s.count},${s.sold},${s.added},${s.removed}`);
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `market-pulse-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(Number(active.id));
    const newIndex = order.indexOf(Number(over.id));
    const newOrder = arrayMove(order, oldIndex, newIndex);
    setOrder(newOrder);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={selectAll}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 transition-colors"
        >
          Select All
        </button>
        <button
          onClick={clear}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={exportCSV}
          disabled={selected.size === 0}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded border border-blue-500 transition-colors"
        >
          Export CSV {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
        <span className="text-gray-600 text-xs ml-1">{selected.size} of {scorecards.length} selected</span>
      </div>

      {/* Sortable grid */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sorted.map((row) => (
              <SortableCard
                key={row.id}
                row={row}
                isSelected={selected.has(row.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
