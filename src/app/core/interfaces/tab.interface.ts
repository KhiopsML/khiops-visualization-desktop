/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

export interface Tab {
  id: string;
  title: string;
  filePath: string | null;
  componentType: 'visualization' | 'covisualization';
  isActive: boolean;
  isDirty: boolean;
  isLoading: boolean;
  datas?: any;
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}
