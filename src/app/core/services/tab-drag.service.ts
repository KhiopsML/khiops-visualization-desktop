/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable, NgZone } from '@angular/core';
import { TabManagerService } from './tab-manager.service';

interface DragContext {
  tabId: string;
  tabEl: HTMLElement;
  ghostEl: HTMLElement;
  listEl: HTMLElement;
  tabEls: HTMLElement[];
  tabWidth: number;
  originIndex: number;
  currentIndex: number;
  pointerOffsetX: number;
  listLeft: number;
  listRight: number;
  started: boolean;
  startX: number;
}

@Injectable({ providedIn: 'root' })
export class TabDragService {
  private ctx: DragContext | null = null;

  private onMove = (e: PointerEvent) => this.handleMove(e);
  private onUp = (e: PointerEvent) => this.handleUp(e);

  constructor(
    private tabManager: TabManagerService,
    private ngZone: NgZone,
  ) {}

  /**
   * Call this from (pointerdown) on each .tab element.
   * Pass the tab id and the native tab element.
   */
  startDrag(event: PointerEvent, tabId: string, tabEl: HTMLElement): void {
    // Only left button; ignore close button clicks
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.tab-close')) return;

    // Prevent text selection
    event.preventDefault();

    const listEl = tabEl.parentElement as HTMLElement;
    const tabEls = Array.from(
      listEl.querySelectorAll<HTMLElement>('.tab:not(.tab--ghost)'),
    );
    const originIndex = tabEls.indexOf(tabEl);
    const rect = tabEl.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();

    this.ctx = {
      tabId,
      tabEl,
      ghostEl: null as any, // created on first move > threshold
      listEl,
      tabEls,
      tabWidth: rect.width,
      originIndex,
      currentIndex: originIndex,
      pointerOffsetX: event.clientX - rect.left,
      listLeft: listRect.left,
      listRight: listRect.right,
      started: false,
      startX: event.clientX,
    };

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('pointermove', this.onMove, { passive: false });
      document.addEventListener('pointerup', this.onUp);
    });
  }

  /**
   * Handle pointer move events during a drag operation.
   * @param e The pointer event.
   */
  private handleMove(e: PointerEvent): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const dx = e.clientX - ctx.startX;

    // Start drag only after 4px threshold
    if (!ctx.started) {
      if (Math.abs(dx) < 4) return;
      ctx.started = true;
      this.beginVisualDrag(ctx);
    }

    // Move ghost
    const ghostLeft = e.clientX - ctx.pointerOffsetX - ctx.listLeft;
    const clamped = Math.max(
      0,
      Math.min(ctx.listRight - ctx.listLeft - ctx.tabWidth, ghostLeft),
    );
    ctx.ghostEl.style.left = clamped + 'px';

    // Compute new logical index from ghost center
    const ghostCenter = clamped + ctx.tabWidth / 2;
    const newIndex = Math.max(
      0,
      Math.min(ctx.tabEls.length - 1, Math.floor(ghostCenter / ctx.tabWidth)),
    );

    if (newIndex !== ctx.currentIndex) {
      ctx.currentIndex = newIndex;
      this.shiftSiblings(ctx);
    }
  }

  /**
   * Handle pointer up events to finalize a drag operation.
   * @param _e The pointer event.
   * @returns void
   */
  private handleUp(_e: PointerEvent): void {
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);

    if (!this.ctx) return;
    const ctx = this.ctx;

    if (!ctx.started) {
      this.ctx = null;
      return;
    }

    // Clean up ALL visual state BEFORE Angular re-renders
    // 1. Remove ghost
    ctx.ghostEl?.remove();

    // 2. Restore source tab opacity NOW — if we wait until after moveTab(),
    //    Angular destroys and recreates the DOM node so opacity: 0
    //    is never reset → tab invisible.
    ctx.tabEl.style.opacity = '';
    ctx.tabEl.style.transition = '';

    // 3. Reset sibling transforms without animation
    ctx.tabEls.forEach((el) => {
      el.style.transition = 'none';
      el.style.transform = '';
    });

    // 4. Remove grabbing cursor
    ctx.listEl.closest('.tab-header')?.classList.remove('is-dragging');

    const { tabId, currentIndex, originIndex } = ctx;
    this.ctx = null; // clear before ngZone.run to avoid stale refs

    // 5. Commit reorder — triggers Angular change detection
    if (currentIndex !== originIndex) {
      this.ngZone.run(() => {
        this.tabManager.moveTab(tabId, currentIndex);
      });
    }
  }

  /**
   * Begin the visual drag operation by creating a ghost element and updating the UI.
   * @param ctx The drag context.
   */
  private beginVisualDrag(ctx: DragContext): void {
    // 1. Clone the tab as ghost, inject into list (absolute positioned)
    const ghost = ctx.tabEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('tab--ghost');
    ghost.style.position = 'absolute';
    ghost.style.top = '0';
    ghost.style.left = ctx.tabEl.offsetLeft + 'px';
    ghost.style.width = ctx.tabWidth + 'px';
    ghost.style.zIndex = '9999';
    ghost.style.transition = 'none';
    ghost.style.pointerEvents = 'none';
    ghost.style.willChange = 'left';
    ctx.listEl.appendChild(ghost);
    ctx.ghostEl = ghost;

    // 2. Activate tab if not already active
    this.ngZone.run(() => this.tabManager.setActiveTab(ctx.tabId));

    // 3. Make the source tab invisible (keep its layout slot)
    ctx.tabEl.style.opacity = '0';
    ctx.tabEl.style.transition = 'none';

    // 3. Add dragging class on bar for cursor
    ctx.listEl.closest('.tab-header')?.classList.add('is-dragging');
  }

  /**
   * Shift sibling tabs to make room for the dragged tab.
   * @param ctx The drag context.
   */
  private shiftSiblings(ctx: DragContext): void {
    ctx.tabEls.forEach((el, i) => {
      if (el === ctx.tabEl) return; // source stays hidden, skip
      let offset = 0;
      if (i < ctx.originIndex && i >= ctx.currentIndex) {
        offset = ctx.tabWidth; // slide right
      } else if (i > ctx.originIndex && i <= ctx.currentIndex) {
        offset = -ctx.tabWidth; // slide left
      }
      el.style.transition = 'transform 0.18s cubic-bezier(0.25,0.46,0.45,0.94)';
      el.style.transform = offset !== 0 ? `translateX(${offset}px)` : '';
    });
  }
}
