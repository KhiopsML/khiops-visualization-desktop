/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Tab {
  id: string;
  title: string;
  filePath: string;
  componentType: 'visualization' | 'covisualization';
  isDirty: boolean;
  data?: any;
}

@Injectable({
  providedIn: 'root',
})
export class TabService {
  private tabs$ = new BehaviorSubject<Tab[]>([]);
  private activeTabId$ = new BehaviorSubject<string | null>(null);
  private tabIdCounter = 0;

  getTabs(): Observable<Tab[]> {
    return this.tabs$.asObservable();
  }

  getActiveTabId(): Observable<string | null> {
    return this.activeTabId$.asObservable();
  }

  getActiveTab(): Tab | null {
    const activeId = this.activeTabId$.getValue();
    if (!activeId) {
      return null;
    }
    return this.tabs$.getValue().find((tab) => tab.id === activeId) || null;
  }

  getCurrentTabs(): Tab[] {
    return this.tabs$.getValue();
  }

  determineComponentFromFile(
    filePath: string
  ): 'visualization' | 'covisualization' {
    if (!filePath) {
      return 'visualization';
    }

    const extension = filePath.toLowerCase().split('.').pop();

    switch (extension) {
      case 'khj':
        return 'visualization';
      case 'khcj':
        return 'covisualization';
      case 'json':
        return 'visualization';
      default:
        return 'visualization';
    }
  }

  openFile(filePath: string, fileName?: string): string {
    // Determine initial component type from file extension
    // For JSON files, we'll update this after reading the file content
    const componentType = this.determineComponentFromFile(filePath);
    const title = fileName || this.getFileNameFromPath(filePath);
    const id = `tab-${this.tabIdCounter++}`;

    const newTab: Tab = {
      id,
      title,
      filePath,
      componentType,
      isDirty: false,
    };

    const currentTabs = this.tabs$.getValue();
    this.tabs$.next([...currentTabs, newTab]);
    this.activeTabId$.next(id);

    return id;
  }

  closeTab(tabId: string) {
    const currentTabs = this.tabs$.getValue();
    const filtered = currentTabs.filter((tab) => tab.id !== tabId);

    if (filtered.length === 0) {
      // Close the application or keep it open - for now, just clear tabs
      this.tabs$.next([]);
      this.activeTabId$.next(null);
    } else {
      this.tabs$.next(filtered);

      // If closed tab was active, switch to the previous or next tab
      if (this.activeTabId$.getValue() === tabId) {
        const closedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        const newActiveTab =
          filtered[Math.max(0, closedIndex - 1)] || filtered[0];
        this.activeTabId$.next(newActiveTab.id);
      }
    }
  }

  switchToTab(tabId: string) {
    const tabs = this.tabs$.getValue();
    if (tabs.find((tab) => tab.id === tabId)) {
      this.activeTabId$.next(tabId);
    }
  }

  setTabDirty(tabId: string, isDirty: boolean) {
    const currentTabs = this.tabs$.getValue();
    const updated = currentTabs.map((tab) =>
      tab.id === tabId ? { ...tab, isDirty } : tab
    );
    this.tabs$.next(updated);
  }

  updateTabTitle(tabId: string, title: string) {
    const currentTabs = this.tabs$.getValue();
    const updated = currentTabs.map((tab) =>
      tab.id === tabId ? { ...tab, title } : tab
    );
    this.tabs$.next(updated);
  }

  setTabData(tabId: string, data: any) {
    const currentTabs = this.tabs$.getValue();
    const updated = currentTabs.map((tab) =>
      tab.id === tabId ? { ...tab, data } : tab
    );
    this.tabs$.next(updated);
  }

  getTabData(tabId: string): any {
    const tab = this.tabs$.getValue().find((t) => t.id === tabId);
    return tab?.data;
  }

  updateTabComponentType(
    tabId: string,
    componentType: 'visualization' | 'covisualization'
  ) {
    const currentTabs = this.tabs$.getValue();
    const updated = currentTabs.map((tab) =>
      tab.id === tabId ? { ...tab, componentType } : tab
    );
    this.tabs$.next(updated);
  }

  reorderTabs(tabs: Tab[]) {
    this.tabs$.next(tabs);
  }

  private getFileNameFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || 'New Tab';
  }
}
