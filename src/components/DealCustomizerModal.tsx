"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Minus, Check, Layers, ChevronRight, AlertCircle } from 'lucide-react';
import { MenuItem, Category, Modifier } from '@/types/database';
import { isDrinkOrRetailItem } from '@/lib/menu-data';
import { MuchachosSymbol } from "./MuchachosBrand";

export interface ConstituentModifierSelection {
  modifier_id: string;
  name: string;
  price: number;
  qty: number;
}

export interface ConstituentSlotSelection {
  slotId: string;
  slotIndex: number;
  slotTitle: string;
  isCategoryChoice: boolean;
  categoryId?: string;
  selectedItemId: string | null;
  selectedItemName: string | null;
  selectedItemPrice?: number;
  modifiers: ConstituentModifierSelection[];
}

export interface DealCustomizerResult {
  menu_item_id: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  modifiers_json: any[];
  deal_swaps_json: {
    slot_id: string;
    slot_title: string;
    menu_item_id: string;
    item_name: string;
    quantity: number;
    modifiers: ConstituentModifierSelection[];
  }[];
}

interface DealCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealItem: MenuItem | null;
  dealComponents: any[];
  allMenuItems: MenuItem[];
  categories: Category[];
  availableModifiers: Modifier[];
  onConfirm: (result: DealCustomizerResult) => void;
}

export default function DealCustomizerModal({
  isOpen,
  onClose,
  dealItem,
  dealComponents,
  allMenuItems,
  categories,
  availableModifiers,
  onConfirm,
}: DealCustomizerModalProps) {
  const [slots, setSlots] = useState<ConstituentSlotSelection[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  // Initialize slots when dealItem or dealComponents changes
  useEffect(() => {
    if (!isOpen || !dealItem) {
      setSlots([]);
      setActiveSlotId(null);
      return;
    }

    const comps = dealComponents.filter(dc => dc.deal_id === dealItem.id);
    const newSlots: ConstituentSlotSelection[] = [];
    let slotCounter = 0;

    comps.forEach(dc => {
      const qty = Math.max(1, Number(dc.quantity) || 1);
      const isCat = Boolean(dc.category_id && !dc.menu_item_id);

      for (let i = 0; i < qty; i++) {
        slotCounter++;
        const slotId = `${dc.id}-${i}`;

        if (isCat) {
          const cat = categories.find(c => c.id === dc.category_id);
          const catName = cat?.name || 'Category';
          const title = dc.slot_title 
            ? (qty > 1 ? `${dc.slot_title} (#${i + 1})` : dc.slot_title)
            : (qty > 1 ? `Choose ${catName} #${i + 1}` : `Choose ${catName}`);

          newSlots.push({
            slotId,
            slotIndex: slotCounter,
            slotTitle: title,
            isCategoryChoice: true,
            categoryId: dc.category_id,
            selectedItemId: null,
            selectedItemName: null,
            modifiers: []
          });
        } else {
          // Specific fixed item
          const item = allMenuItems.find(m => m.id === dc.menu_item_id) || dc.child;
          const itemName = item?.name || 'Selected Item';
          const title = qty > 1 ? `${itemName} (#${i + 1})` : itemName;

          newSlots.push({
            slotId,
            slotIndex: slotCounter,
            slotTitle: title,
            isCategoryChoice: false,
            selectedItemId: dc.menu_item_id,
            selectedItemName: itemName,
            selectedItemPrice: item?.price,
            modifiers: []
          });
        }
      }
    });

    setSlots(newSlots);
    if (newSlots.length > 0) {
      // Set the first category slot (or first slot) active
      const firstIncomplete = newSlots.find(s => s.isCategoryChoice && !s.selectedItemId) || newSlots[0];
      setActiveSlotId(firstIncomplete.slotId);
    }
  }, [isOpen, dealItem, dealComponents, allMenuItems, categories]);

  if (!isOpen || !dealItem) return null;

  // Handle selecting an item for a category slot
  const handleSelectItemForSlot = (slotId: string, item: MenuItem) => {
    setSlots(prev => prev.map(s => {
      if (s.slotId === slotId) {
        return {
          ...s,
          selectedItemId: item.id,
          selectedItemName: item.name,
          selectedItemPrice: item.price
        };
      }
      return s;
    }));

    // Auto-advance to next incomplete slot if any
    const currentIndex = slots.findIndex(s => s.slotId === slotId);
    const nextIncomplete = slots.find((s, idx) => idx > currentIndex && s.isCategoryChoice && !s.selectedItemId);
    if (nextIncomplete) {
      setActiveSlotId(nextIncomplete.slotId);
    }
  };

  // Add modifier to a specific slot
  const handleAddModifier = (slotId: string, mod: Modifier) => {
    setSlots(prev => prev.map(s => {
      if (s.slotId !== slotId) return s;

      const existingIndex = s.modifiers.findIndex(m => m.modifier_id === mod.id);
      if (existingIndex > -1) {
        const updated = [...s.modifiers];
        updated[existingIndex] = {
          ...updated[existingIndex],
          qty: updated[existingIndex].qty + 1
        };
        return { ...s, modifiers: updated };
      } else {
        return {
          ...s,
          modifiers: [
            ...s.modifiers,
            { modifier_id: mod.id, name: mod.name, price: mod.price, qty: 1 }
          ]
        };
      }
    }));
  };

  // Remove modifier from a specific slot
  const handleRemoveModifier = (slotId: string, modifierId: string) => {
    setSlots(prev => prev.map(s => {
      if (s.slotId !== slotId) return s;

      const existing = s.modifiers.find(m => m.modifier_id === modifierId);
      if (!existing) return s;

      if (existing.qty <= 1) {
        return {
          ...s,
          modifiers: s.modifiers.filter(m => m.modifier_id !== modifierId)
        };
      } else {
        return {
          ...s,
          modifiers: s.modifiers.map(m => 
            m.modifier_id === modifierId ? { ...m, qty: m.qty - 1 } : m
          )
        };
      }
    }));
  };

  // Check validation: all category slots must have an item chosen
  const unselectedCount = slots.filter(s => s.isCategoryChoice && !s.selectedItemId).length;
  const isComplete = unselectedCount === 0;

  // Calculate pricing
  const basePrice = dealItem.price || 0;
  const modifiersTotal = slots.reduce((sum, s) => {
    return sum + s.modifiers.reduce((mSum, m) => mSum + (m.price * m.qty), 0);
  }, 0);
  const finalUnitPrice = basePrice + modifiersTotal;

  const handleConfirm = () => {
    if (!isComplete) return;

    const dealSwaps = slots.map(s => ({
      slot_id: s.slotId,
      slot_title: s.slotTitle,
      menu_item_id: s.selectedItemId || '',
      item_name: s.selectedItemName || 'Item',
      quantity: 1,
      modifiers: s.modifiers
    }));

    onConfirm({
      menu_item_id: dealItem.id,
      item_name: dealItem.name,
      unit_price: finalUnitPrice,
      quantity: 1,
      total_price: finalUnitPrice,
      modifiers_json: [],
      deal_swaps_json: dealSwaps
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in select-none">
      <div className="bg-card text-cardForeground w-full max-w-2xl max-h-[92vh] rounded-3xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in zoom-in-95">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center p-2 shadow-sm shrink-0 border border-red-500/40">
              <MuchachosSymbol size={28} color="#FFFFFF" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full border border-red-500/20">
                  MUCHACHOS DEAL
                </span>
                <span className="text-xs font-bold text-mutedForeground">
                  Base: Rs. {basePrice.toLocaleString()}
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-black text-foreground tracking-tight flex items-center gap-2">
                {dealItem.name}
              </h3>
              <p className="text-[10px] font-serif italic text-mutedForeground">An Oasis Of Taste</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-muted text-mutedForeground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Slots List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {slots.length === 0 ? (
            <div className="p-8 text-center text-mutedForeground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40 text-amber-500" />
              <p className="font-bold text-sm">No constituent items configured for this deal.</p>
              <p className="text-xs mt-1">You can configure deal items in the Owner Dashboard &gt; Menu &gt; Deals tab.</p>
            </div>
          ) : (
            slots.map((slot) => {
              const isSelected = Boolean(slot.selectedItemId);
              const isExpanded = activeSlotId === slot.slotId;
              const slotCategory = categories.find(c => c.id === slot.categoryId);
              const categoryItems = slot.isCategoryChoice 
                ? allMenuItems.filter(m => m.category_id === slot.categoryId && m.is_available !== false)
                : [];

              return (
                <div 
                  key={slot.slotId}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    !isSelected && slot.isCategoryChoice
                      ? 'border-amber-400/80 bg-amber-500/5 shadow-xs'
                      : isExpanded
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card'
                  }`}
                >
                  {/* Slot Header Banner */}
                  <div 
                    onClick={() => setActiveSlotId(isExpanded ? null : slot.slotId)}
                    className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                        isSelected 
                          ? 'bg-emerald-500 text-white shadow-xs' 
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                      }`}>
                        {isSelected ? <Check className="w-4 h-4" /> : slot.slotIndex}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-foreground truncate">
                            {slot.slotTitle}
                          </span>
                          {slot.isCategoryChoice ? (
                            <span className="text-[10px] font-bold text-mutedForeground bg-muted px-1.5 py-0.5 rounded">
                              {slotCategory?.name || 'Choice'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                              Fixed Item
                            </span>
                          )}
                        </div>

                        {isSelected ? (
                          <p className="text-xs font-bold text-primary mt-0.5 flex items-center gap-1.5 truncate">
                            <span>Selected: {slot.selectedItemName}</span>
                            {slot.modifiers.length > 0 && (
                              <span className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 rounded font-black">
                                +{slot.modifiers.reduce((c, m) => c + m.qty, 0)} add-ons
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                            * Tap to choose item from {slotCategory?.name || 'category'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button className="text-xs font-bold text-mutedForeground hover:text-foreground p-1">
                        <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Content: Item Picker & Add-ons */}
                  {isExpanded && (
                    <div className="p-4 border-t border-border bg-card/60 space-y-4">
                      {/* Category Options Selection */}
                      {slot.isCategoryChoice && (
                        <div>
                          <label className="text-[11px] font-black text-mutedForeground uppercase tracking-wider block mb-2">
                            Select Product:
                          </label>
                          {categoryItems.length === 0 ? (
                            <p className="text-xs text-mutedForeground italic">No active products in this category.</p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {categoryItems.map(item => {
                                const isItemActive = slot.selectedItemId === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleSelectItemForSlot(slot.slotId, item)}
                                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                                      isItemActive
                                        ? 'border-primary bg-primary text-primaryForeground shadow-sm'
                                        : 'border-border bg-muted/30 hover:border-primary/50 text-foreground'
                                    }`}
                                  >
                                    <span className="font-black text-xs leading-snug line-clamp-2">
                                      {item.name}
                                    </span>
                                    <span className={`text-[11px] font-bold mt-1 ${isItemActive ? 'text-primaryForeground/90' : 'text-mutedForeground'}`}>
                                      Rs. {item.price}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Add-ons & Modifiers for this specific item */}
                      {isSelected && (
                        <div className="pt-2 border-t border-border/60">
                          {(() => {
                            const selectedItemObj = allMenuItems.find(i => i.id === slot.selectedItemId) || { name: slot.selectedItemName, category_id: slot.categoryId };
                            const isSlotDrinkOrRetail = isDrinkOrRetailItem(selectedItemObj, categories);

                            if (isSlotDrinkOrRetail) {
                              return (
                                <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs text-mutedForeground font-medium">
                                  🥤 Beverage / retail item • No kitchen add-ons applicable
                                </div>
                              );
                            }

                            return (
                              <>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-[11px] font-black text-mutedForeground uppercase tracking-wider">
                                    Add-ons for {slot.selectedItemName}:
                                  </label>
                                  {slot.modifiers.length > 0 && (
                                    <span className="text-[11px] font-black text-amber-600 dark:text-amber-400">
                                      + Rs. {slot.modifiers.reduce((sum, m) => sum + (m.price * m.qty), 0)}
                                    </span>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {availableModifiers.map(mod => {
                                    const currentMod = slot.modifiers.find(m => m.modifier_id === mod.id);
                                    const hasMod = Boolean(currentMod && currentMod.qty > 0);

                                    return (
                                      <div 
                                        key={mod.id}
                                        className={`flex items-center justify-between p-2 rounded-xl border text-xs transition-colors ${
                                          hasMod 
                                            ? 'bg-amber-500/10 border-amber-500/40 text-foreground font-bold' 
                                            : 'bg-muted/20 border-border text-foreground'
                                        }`}
                                      >
                                        <div className="min-w-0 pr-2">
                                          <p className="truncate font-medium">{mod.name}</p>
                                          <p className="text-[10px] text-mutedForeground font-semibold">+Rs. {mod.price}</p>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {hasMod && (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveModifier(slot.slotId, mod.id)}
                                                className="w-6 h-6 rounded-lg bg-card text-foreground hover:bg-red-500 hover:text-white flex items-center justify-center font-bold text-xs border border-border"
                                              >
                                                <Minus className="w-3 h-3" />
                                              </button>
                                              <span className="w-4 text-center font-black text-xs text-amber-600 dark:text-amber-400">
                                                {currentMod?.qty}
                                              </span>
                                            </>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => handleAddModifier(slot.slotId, mod)}
                                            className="w-6 h-6 rounded-lg bg-primary text-primaryForeground hover:opacity-90 flex items-center justify-center font-bold text-xs shadow-xs"
                                          >
                                            <Plus className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer & Action Bar */}
        <div className="p-4 sm:p-5 border-t border-border bg-muted/40 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto gap-4">
            <div>
              <span className="text-[10px] font-black uppercase text-mutedForeground tracking-wider block">
                Total Deal Price
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-black text-foreground">
                  Rs. {finalUnitPrice.toLocaleString()}
                </span>
                {modifiersTotal > 0 && (
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                    (+Rs. {modifiersTotal} add-ons)
                  </span>
                )}
              </div>
            </div>

            {!isComplete && (
              <span className="text-[11px] font-bold text-amber-600 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg">
                ⚠️ {unselectedCount} slot{unselectedCount > 1 ? 's' : ''} left
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-border bg-card text-foreground font-bold text-xs hover:bg-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isComplete}
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-primary text-primaryForeground font-black text-xs tracking-wider uppercase shadow-md hover:opacity-95 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Add Deal to Order
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
