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
export class ConfigService {
  private config: any;
  private activeComponentType: 'visualization' | 'covisualization' = 'visualization';

  constructor(private electronService: ElectronService) {}

  setConfig(config: any) {
    this.config = config;
  }

  getConfig(): any {
    return this.config;
  }

  setActiveComponentType(componentType: 'visualization' | 'covisualization') {
    this.activeComponentType = componentType;
  }

  getActiveComponentType(): 'visualization' | 'covisualization' {
    return this.activeComponentType;
  }

  private componentChangeCallback?: (componentType: 'visualization' | 'covisualization') => void;

  setComponentChangeCallback(callback: (componentType: 'visualization' | 'covisualization') => void) {
    this.componentChangeCallback = callback;
  }

  async requestComponentChange(filePath: string) {
    if (!this.componentChangeCallback) {
      return;
    }

    const extension = filePath.toLowerCase().split('.').pop();
    let requiredComponent: 'visualization' | 'covisualization' = 'visualization';
    
    switch (extension) {
      case 'khj':
        requiredComponent = 'visualization';
        break;
      case 'khcj':
        requiredComponent = 'covisualization';
        break;
      case 'json':
        requiredComponent = await this.analyzeJsonContent(filePath);
        break;
      default:
        requiredComponent = 'visualization';
    }

    this.componentChangeCallback(requiredComponent);
  }

  private async analyzeJsonContent(filePath: string): Promise<'visualization' | 'covisualization'> {
    try {
      const content = await new Promise<string>((resolve, reject) => {
        this.electronService.fs.readFile(filePath, 'utf-8', (err: any, data: string) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
      });

      const jsonData = JSON.parse(content);
      const tool = jsonData.tool;

      if (tool === 'Khiops Coclustering') {
        return 'covisualization';
      } else if (tool === 'Khiops') {
        return 'visualization';
      } else {
        return 'visualization';
      }
    } catch (error) {
      return 'visualization';
    }
  }

  setDatas(datas = undefined) {
    this.config.setDatas(datas);
  }
  constructDatasToSave() {
    this.config.constructDatasToSave();
  }

  constructPrunedDatasToSave() {
    this.config.constructPrunedDatasToSave();
  }

  openChannelDialog(cb: Function) {
    this.config.openChannelDialog(cb);
  }

  openSaveBeforeQuitDialog(cb: Function) {
    this.config.openSaveBeforeQuitDialog(cb);
  }

  snack(text: string, duration: number, panelClass: string) {
    this.config.snack(text, duration, panelClass);
  }
}
