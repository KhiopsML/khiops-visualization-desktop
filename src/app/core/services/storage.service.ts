/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private _storage: any = {};
  private _storageKey: string = 'KHIOPS_VISUALIZATION_DESKTOP';

  // Storage for individual tab instances
  private _tabStorages: Map<string, any> = new Map();

  constructor(private electronService: ElectronService) {
    try {
      // Use userData directory instead of temp directory to persist data across updates
      // This ensures that settings, cookies consent, channel, history... are preserved during OTA updates
      const path = this.electronService.isElectron
        ? window.require('path')
        : null;
      if (!path) {
        console.warn(
          'Path module not available, using default storage location',
        );
        return;
      }

      const userDataPath = path.join(
        this.electronService.remote?.app?.getPath('documents') || '',
        'khiops-visualization-desktop',
      );
      if (userDataPath) {
        // eg. C:\Users\USER\Documents\hiops-visualization-desktop
        this.electronService.storage?.setDataPath(userDataPath);
        console.log('Storage path set to:', userDataPath);
      } else {
        console.warn(
          'Could not get userData path, using default storage location',
        );
      }
    } catch (error) {
      console.error(
        'Failed to set persistent storage path, falling back to default:',
        error,
      );
      // If userData path fails, electron-json-storage will use its default location
    }
    // this.electronService.storage?.setDataPath(this.electronService.os.tmpdir());

    this.getAll();
  }

  saveAll(cb?: Function) {
    this.electronService.storage?.set(this._storageKey, this._storage, () => {
      cb && cb();
    });
  }

  getAll() {
    try {
      this._storage =
        this.electronService.storage?.getSync(this._storageKey) || {};
    } catch {
      this.electronService.storage?.set(this._storageKey, {});
    }
    return this._storage;
  }

  delAll() {
    this.electronService.storage?.clear();
  }

  getOne(elt: string) {
    return this._storage ? this._storage[elt] : undefined;
  }

  setOne(elt: string, value: any) {
    this._storage[elt] = value;
    // Automatically save to disk after each modification to ensure persistence
    this.saveAll();
  }

  getStorageKey() {
    return this._storageKey;
  }

  // Tab-specific storage methods for isolated instances
  getTabStorage(instanceId: string): any {
    if (!this._tabStorages.has(instanceId)) {
      // Initialize with empty storage for this tab instance
      this._tabStorages.set(instanceId, {});
    }
    return this._tabStorages.get(instanceId);
  }

  saveTabStorage(instanceId: string, cb?: Function) {
    const tabStorage = this._tabStorages.get(instanceId);
    if (tabStorage) {
      const tabStorageKey = `${this._storageKey}_tab_${instanceId}`;
      this.electronService.storage?.set(tabStorageKey, tabStorage, () => {
        console.log('Saved tab storage for instance:', instanceId);
        cb && cb();
      });
    }
  }

  delTabStorage(instanceId: string) {
    this._tabStorages.delete(instanceId);
    const tabStorageKey = `${this._storageKey}_tab_${instanceId}`;
    this.electronService.storage?.remove(tabStorageKey, (error: any) => {
      if (error) console.error('Error deleting tab storage:', error);
      else console.log('Deleted tab storage for instance:', instanceId);
    });
  }

  setTabStorageItem(instanceId: string, key: string, value: any) {
    if (!this._tabStorages.has(instanceId)) {
      this._tabStorages.set(instanceId, {});
    }
    const tabStorage = this._tabStorages.get(instanceId)!;
    tabStorage[key] = value;
    // Auto-save tab storage
    this.saveTabStorage(instanceId);
  }

  getTabStorageItem(instanceId: string, key: string): any {
    const tabStorage = this._tabStorages.get(instanceId);
    return tabStorage ? tabStorage[key] : undefined;
  }
}
