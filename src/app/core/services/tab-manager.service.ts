/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Tab, TabState } from '../interfaces/tab.interface';

@Injectable({
  providedIn: 'root',
})
export class TabManagerService {
  private readonly tabState = new BehaviorSubject<TabState>({
    tabs: [],
    activeTabId: null,
  });

  readonly tabState$ = this.tabState.asObservable();

  private tabCounter = 0;

  constructor() {
    // Start with no tabs - user opens files explicitly
  }

  /**
   * Create a new empty tab
   */
  createNewTab(): string {
    this.tabCounter++;
    const newTab: Tab = {
      id: `tab-${this.tabCounter}`,
      title: `New Tab ${this.tabCounter}`,
      filePath: null,
      componentType: 'visualization',
      isActive: false,
      isDirty: false,
      isLoading: false,
    };

    const currentState = this.tabState.value;
    const updatedTabs = [...currentState.tabs, newTab];

    // Set new tab as active
    this.setActiveTab(newTab.id, updatedTabs);

    return newTab.id;
  }

  /**
   * Open file in a new tab or existing tab
   */
  openFileInTab(
    filePath: string,
    componentType: 'visualization' | 'covisualization',
    tabId?: string,
  ): string {
    const currentState = this.tabState.value;
    const fileName = this.getFileNameFromPath(filePath);

    // Check if file is already open in an existing tab
    const existingTab = currentState.tabs.find((tab) => tab.filePath === filePath);
    if (existingTab) {
      this.setActiveTab(existingTab.id);
      return existingTab.id;
    }

    let targetTabId = tabId;
    let updatedTabs = [...currentState.tabs];

    // If no specific tab, create new one or use empty tab
    if (!targetTabId) {
      const emptyTab = updatedTabs.find((tab) => !tab.filePath);
      if (emptyTab) {
        targetTabId = emptyTab.id;
      } else {
        targetTabId = this.createNewTab();
        return this.openFileInTab(filePath, componentType, targetTabId);
      }
    }

    // Update the target tab
    const tabIndex = updatedTabs.findIndex((tab) => tab.id === targetTabId);
    if (tabIndex !== -1) {
      updatedTabs[tabIndex] = {
        ...updatedTabs[tabIndex],
        title: fileName,
        filePath: filePath,
        componentType: componentType,
        isLoading: true,
        isDirty: false,
      };
    }

    this.setActiveTab(targetTabId, updatedTabs);
    return targetTabId;
  }

  /**
   * Close a tab
   */
  closeTab(tabId: string): void {
    const currentState = this.tabState.value;
    const tabToClose = currentState.tabs.find((tab) => tab.id === tabId);

    if (!tabToClose) return;

    // TODO: Handle dirty files - show save dialog
    if (tabToClose.isDirty) {
      // For now, just close. Later add save confirmation dialog
    }

    const updatedTabs = currentState.tabs.filter((tab) => tab.id !== tabId);

    let newActiveTabId = currentState.activeTabId;

    // If closing active tab, activate another one
    if (currentState.activeTabId === tabId) {
      if (updatedTabs.length > 0) {
        newActiveTabId = updatedTabs[updatedTabs.length - 1].id;
      } else {
        newActiveTabId = null;
      }
    }

    // If no tabs left, just update state - don't create new empty tab
    if (updatedTabs.length === 0) {
      this.tabState.next({ tabs: [], activeTabId: null });
    } else {
      // Update isActive flags for remaining tabs
      const tabsWithActiveFlags = updatedTabs.map((tab) => ({
        ...tab,
        isActive: tab.id === newActiveTabId,
      }));
      this.tabState.next({
        tabs: tabsWithActiveFlags,
        activeTabId: newActiveTabId,
      });
    }
  }

  /**
   * Set active tab
   */
  setActiveTab(tabId: string, tabsOverride?: Tab[]): void {
    const currentState = this.tabState.value;
    const tabs = tabsOverride || currentState.tabs;

    const updatedTabs = tabs.map((tab) => ({
      ...tab,
      isActive: tab.id === tabId,
    }));

    this.tabState.next({
      tabs: updatedTabs,
      activeTabId: tabId,
    });
  }

  /**
   * Update tab data (loading state, data, etc.)
   */
  updateTab(tabId: string, updates: Partial<Tab>): void {
    const currentState = this.tabState.value;
    const updatedTabs = currentState.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, ...updates } : tab,
    );

    this.tabState.next({
      ...currentState,
      tabs: updatedTabs,
    });
  }

  /**
   * Get current active tab
   */
  getActiveTab(): Tab | null {
    const currentState = this.tabState.value;
    return currentState.tabs.find((tab) => tab.isActive) || null;
  }

  /**
   * Get tab by ID
   */
  getTab(tabId: string): Tab | null {
    const currentState = this.tabState.value;
    return currentState.tabs.find((tab) => tab.id === tabId) || null;
  }

  /**
   * Get tab by file path
   */
  getTabByFilePath(filePath: string): Tab | null {
    const currentState = this.tabState.value;
    return currentState.tabs.find((tab) => tab.filePath === filePath) || null;
  }

  /**
   * Mark tab as dirty (has unsaved changes)
   */
  markTabDirty(tabId: string, isDirty: boolean = true): void {
    this.updateTab(tabId, { isDirty });
  }

  /**
   * Extract filename from file path
   */
  private getFileNameFromPath(filePath: string): string {
    if (!filePath) return 'Untitled';
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'Untitled';
  }

  /**
   * Move a tab to a new index in the tab list.
   * @param tabId The ID of the tab to move.
   * @param toIndex The new index for the tab.
   */
  moveTab(tabId: string, toIndex: number): void {
    const state = this.tabState.value;
    const tabs = [...state.tabs];
    const fromIndex = tabs.findIndex((t) => t.id === tabId);
    if (fromIndex === -1 || fromIndex === toIndex) return;

    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);

    this.tabState.next({ ...state, tabs });
  }

  /**
   * Restore a tab from detached tab data
   * @param tabData The tab data to restore
   */
  restoreTab(tabData: Tab): void {
    const currentState = this.tabState.value;
    
    // Create a new tab with the provided data but generate a new ID
    this.tabCounter++;
    const restoredTab: Tab = {
      ...tabData,
      id: `tab-${this.tabCounter}`,
      isActive: false,
    };

    const updatedTabs = [...currentState.tabs, restoredTab];

    // Set the restored tab as active
    this.setActiveTab(restoredTab.id, updatedTabs);
  }
}
