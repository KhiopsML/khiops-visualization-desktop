/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable, NgZone } from '@angular/core';
import { TabManagerService } from './tab-manager.service';
import { ElectronService } from './electron.service';

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
  lastX: number;
  lastY: number;
  dragImageEl?: HTMLElement; // Custom drag image following pointer
  tabTitle?: string;
  componentType?: string;
}

@Injectable({ providedIn: 'root' })
export class TabDragService {
  private ctx: DragContext | null = null;

  private onMove = (e: PointerEvent) => this.handleMove(e);
  private onUp = (e: PointerEvent) => this.handleUp(e);

  constructor(
    private tabManager: TabManagerService,
    private ngZone: NgZone,
    private electronService: ElectronService,
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

    // Extract tab info for later use in drag visual
    const tabTitle = tabEl.querySelector('.tab-title')?.textContent || 'Tab';
    const imgEl = tabEl.querySelector('.tab-icon img') as HTMLImageElement | null;
    const componentType = imgEl?.getAttribute('alt') || 'visualization';

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
      lastX: event.clientX,
      lastY: event.clientY,
      tabTitle,
      componentType,
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

    // Track last coordinates for outside-container detection
    ctx.lastX = e.clientX;
    ctx.lastY = e.clientY;

    const dx = e.clientX - ctx.startX;

    // Start drag only after 4px threshold
    if (!ctx.started) {
      if (Math.abs(dx) < 4) return;
      ctx.started = true;
      this.beginVisualDrag(ctx);
    }

    // Check if currently outside container
    const listRect = ctx.listEl.getBoundingClientRect();
    const horizontalDistance = Math.min(
      Math.abs(ctx.lastX - listRect.left),
      Math.abs(ctx.lastX - listRect.right)
    );
    const isHorizontallyOutside = ctx.lastX < listRect.left || ctx.lastX > listRect.right;
    const isVerticallyOutside = ctx.lastY < listRect.top - 10 || ctx.lastY > listRect.bottom + 10;
    const isOutside = (isHorizontallyOutside && horizontalDistance > 20) || isVerticallyOutside;

    // Create or update drag image if outside container
    if (isOutside) {
      if (!ctx.dragImageEl) {
        this.createDragImage(ctx);
      }
      // Update position of drag image
      if (ctx.dragImageEl) {
        ctx.dragImageEl.style.left = (ctx.lastX + 10) + 'px';
        ctx.dragImageEl.style.top = (ctx.lastY + 10) + 'px';
      }
    } else {
      // Remove drag image when back inside container
      if (ctx.dragImageEl) {
        ctx.dragImageEl.remove();
        ctx.dragImageEl = undefined;
      }
    }

    // Move ghost - only if still within the container boundaries for reordering
    if (!isOutside) {
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

    // 2. Remove drag image if present
    ctx.dragImageEl?.remove();

    // 3. Restore source tab opacity NOW — if we wait until after moveTab(),
    //    Angular destroys and recreates the DOM node so opacity: 0
    //    is never reset → tab invisible.
    ctx.tabEl.style.opacity = '';
    ctx.tabEl.style.transition = '';

    // 4. Reset sibling transforms without animation
    ctx.tabEls.forEach((el) => {
      el.style.transition = 'none';
      el.style.transform = '';
    });

    // 5. Remove grabbing cursor
    ctx.listEl.closest('.tab-header')?.classList.remove('is-dragging');

    const { tabId, currentIndex, originIndex, lastX, lastY } = ctx;
    this.ctx = null; // clear before ngZone.run to avoid stale refs

    // Check if drop is outside the tab list container
    const listRect = ctx.listEl.getBoundingClientRect();
    
    // Detect outside drop - be more aggressive with horizontal detection (like Chrome)
    const horizontalDistance = Math.min(
      Math.abs(lastX - listRect.left),
      Math.abs(lastX - listRect.right)
    );
    const isHorizontallyOutside = lastX < listRect.left || lastX > listRect.right;
    const isVerticallyOutside = lastY < listRect.top - 10 || lastY > listRect.bottom + 10;
    
    // Detach if:
    // 1. Significantly outside horizontally (>20px), OR
    // 2. Outside vertically
    const isOutsideContainer =
      (isHorizontallyOutside && horizontalDistance > 20) ||
      isVerticallyOutside;

    console.log('[TabDragService] Drop detected:', {
      lastX,
      lastY,
      listRect: { left: listRect.left, right: listRect.right, top: listRect.top, bottom: listRect.bottom },
      isOutsideContainer,
      isElectron: this.electronService.isElectron,
    });

    if (isOutsideContainer && this.electronService.isElectron) {
      // Drag ended outside container - create new window with this tab
      this.ngZone.run(() => {
        this.handleTabDetach(tabId);
      });
    } else if (currentIndex !== originIndex) {
      // Normal reorder within the same container
      this.ngZone.run(() => {
        this.tabManager.moveTab(tabId, currentIndex);
      });
    }
  }

  /**
   * Handle tab detach to create a new Electron window
   * @param tabId The ID of the tab to detach
   */
  private handleTabDetach(tabId: string): void {
    // Get the tab data
    const tab = this.tabManager.getTab(tabId);
    console.log('[TabDragService] handleTabDetach called for tab:', tabId, tab);
    
    if (!tab || !this.electronService.ipcRenderer) {
      console.error('[TabDragService] handleTabDetach failed: tab or ipcRenderer missing');
      return;
    }

    // Send IPC to create new window with this tab
    console.log('[TabDragService] Sending create-window-with-tab IPC');
    this.electronService.ipcRenderer.invoke('create-window-with-tab', {
      tab: tab,
    }).then(() => {
      console.log('[TabDragService] Successfully created new window, closing tab in current window');
      // Close the tab in the current window
      this.tabManager.closeTab(tabId);
    }).catch((error) => {
      console.error('[TabDragService] Error creating new window:', error);
    });
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

    // 4. Add dragging class on bar for cursor
    ctx.listEl.closest('.tab-header')?.classList.add('is-dragging');
  }

  /**
   * Create a visual drag image that follows the pointer
   * @param ctx The drag context
   */
  private createDragImage(ctx: DragContext): void {
    const dragImage = document.createElement('div');
    dragImage.className = 'tab-drag-image';
    dragImage.style.position = 'fixed';
    dragImage.style.zIndex = '10000';
    dragImage.style.pointerEvents = 'none';
    dragImage.style.display = 'flex';
    dragImage.style.alignItems = 'center';
    dragImage.style.gap = '8px';
    dragImage.style.padding = '6px 12px';
    dragImage.style.backgroundColor = '#f0f0f0';
    dragImage.style.border = '1px solid #ccc';
    dragImage.style.borderRadius = '4px';
    dragImage.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    dragImage.style.fontSize = '12px';
    dragImage.style.fontFamily = 'inherit';
    dragImage.style.whiteSpace = 'nowrap';
    dragImage.style.maxWidth = '300px';
    dragImage.style.overflow = 'hidden';
    dragImage.style.textOverflow = 'ellipsis';

    // Add icon
    const iconEl = document.createElement('img');
    iconEl.style.width = '16px';
    iconEl.style.height = '16px';
    iconEl.style.flexShrink = '0';

    if (ctx.componentType === 'covisualization') {
      iconEl.src = 'assets/icons/icon-covisu.png';
    } else {
      iconEl.src = 'assets/icons/icon-visu.png';
    }

    // Add title
    const titleEl = document.createElement('span');
    titleEl.textContent = ctx.tabTitle || 'Tab';
    titleEl.style.overflow = 'hidden';
    titleEl.style.textOverflow = 'ellipsis';

    dragImage.appendChild(iconEl);
    dragImage.appendChild(titleEl);
    document.body.appendChild(dragImage);

    ctx.dragImageEl = dragImage;
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
