"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  getCategories,
  logAudit,
  resetDemoData,
  saveCategories,
  slugify,
} from "@/lib/store";
import { useStore } from "@/lib/useStore";

export default function SettingsPage() {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [name, setName] = useState("");
  const categories = useStore(() => getCategories(), [tick]);

  if (!user || !categories) return null;
  const manager = can.manageCategories(user.role);

  const add = () => {
    if (!name.trim() || !manager) return;
    const all = getCategories();
    all.push({
      slug: slugify(name),
      name: name.trim(),
      kind: null,
      sortOrder: all.length + 1,
      isActive: true,
    });
    saveCategories(all);
    logAudit(user, "added category", "category", name.trim());
    setName("");
    setTick((t) => t + 1);
  };

  const toggle = (slug: string) => {
    if (!manager) return;
    const all = getCategories();
    const c = all.find((x) => x.slug === slug);
    if (!c) return;
    c.isActive = !c.isActive;
    saveCategories(all);
    setTick((t) => t + 1);
  };

  const remove = (slug: string) => {
    if (!manager) return;
    const all = getCategories().filter((x) => x.slug !== slug);
    saveCategories(all);
    setTick((t) => t + 1);
  };

  return (
    <div className="max-w-2xl">
      <SectionHeader
        title="Settings"
        sub="Categories power every editor's dropdown and the app's filter chips."
      />

      <div className="card p-6">
        <h3 className="mb-4 font-bold">Categories</h3>
        {manager && (
          <div className="mb-5 flex gap-2">
            <input
              className="field flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="New category name…"
            />
            <button
              onClick={add}
              disabled={!name.trim()}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-40"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {categories.map((c, i) => (
            <motion.span
              key={c.slug}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-all ${
                c.isActive
                  ? "border-line bg-white shadow-(--shadow-soft)"
                  : "border-dashed border-line text-faint"
              }`}
            >
              <button
                onClick={() => toggle(c.slug)}
                disabled={!manager}
                title={c.isActive ? "Disable" : "Enable"}
              >
                {c.name}
              </button>
              {manager && (
                <button
                  onClick={() => remove(c.slug)}
                  className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </motion.span>
          ))}
        </div>
        {!manager && (
          <p className="mt-4 text-xs text-faint">
            Only chief editors and super admins can edit categories.
          </p>
        )}
      </div>

      <div className="card mt-6 p-6">
        <h3 className="mb-1 font-bold">Demo data</h3>
        <p className="mb-4 text-sm text-muted">
          Everything in this demo lives in your browser's local storage. Reset
          restores the seed content, users and curation.
        </p>
        <button
          onClick={() => {
            resetDemoData();
            location.reload();
          }}
          className="btn-ghost flex items-center gap-2 px-4 py-2 text-xs !text-rose"
        >
          <RotateCcw size={14} /> Reset demo data
        </button>
      </div>

      <div className="card mt-6 p-6">
        <h3 className="mb-1 font-bold">Coming with the backend</h3>
        <p className="text-sm leading-relaxed text-muted">
          When the Supabase database is wired in (see MVP_PLAN.md), this page
          gains: language &amp; state scoping, storage buckets, publish
          scheduling and the NewsStudio read-only connection.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Supabase Auth", "RLS", "Storage", "NewsStudio DB"].map((t) => (
            <Pill key={t} tone="accent">
              {t}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}
