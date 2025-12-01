/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable, NgZone } from '@angular/core';
import { ElectronService } from './electron.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfigService } from './config.service';
import { TabService } from './tab.service';
import { BehaviorSubject, Observable } from 'rxjs';
// @ts-ignore
import Toastify from 'toastify-js';
import { StorageService } from './storage.service';

let es: any;
try {
  es = require('event-stream');
} catch (e) {
  console.warn(e);
}
let jsonStream: any;
try {
  jsonStream = require('JSONStream');
} catch (e) {
  console.warn(e);
}

@Injectable({
  providedIn: 'root',
})
export class FileSystemService {
  fileLoaderDatas?: {
    isLoadingDatas: any;
    datas: any;
    isBigJsonFile: boolean;
    loadingInfo: string;
  };
  currentFilePath = '';

  private _fileLoaderSub: BehaviorSubject<any> = new BehaviorSubject(undefined);
  public fileLoader$: Observable<any> = this._fileLoaderSub.asObservable();

  constructor(
    private ngzone: NgZone,
    private configService: ConfigService,
    private electronService: ElectronService,
    private translate: TranslateService,
    private storageService: StorageService,
    private tabService: TabService
  ) {
    this.initialize();
  }

  initialize() {
    this.fileLoaderDatas = {
      isLoadingDatas: false,
      datas: undefined,
      isBigJsonFile: false,
      loadingInfo: '',
    };
  }

  openFileDialog(callbackDone: Function) {
    // this.trackerService.trackEvent('click', 'open_file');

    const associationFiles = ['json'];
    associationFiles.push('khj');
    associationFiles.push('khcj');

    this.electronService.dialog
      .showOpenDialog(null, {
        properties: ['openFile'],
        filters: [
          {
            extensions: associationFiles,
          },
        ],
      })
      .then((result: Electron.OpenDialogReturnValue) => {
        if (result && !result.canceled && result.filePaths) {
          this.openFile(result.filePaths[0], callbackDone);
          return;
        }
      })
      .catch((err: any) => {
        console.log(err);
      });
  }

  setTitleBar(filepath: string) {
    this.currentFilePath = filepath;
    (async () => {
      try {
        const extension = filepath.toLowerCase().split('.').pop();
        let appType = 'Khiops Visualization';

        if (extension === 'khcj') {
          appType = 'Khiops Covisualization';
        } else if (extension === 'khj') {
          appType = 'Khiops Visualization';
        }

        await this.electronService.ipcRenderer?.invoke('set-title-bar-name', {
          title: appType + ' ' + filepath,
        });
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  async openFile(filename: string, callbackDone?: Function) {
    if (filename) {
      // Open file in new tab
      const fileName = filename.split(/[/\\]/).pop() || filename;
      const tabId = this.tabService.openFile(filename, fileName);

      // Add to file history immediately
      this.setFileHistory(filename);

      // Wait for component to be fully initialized in the tab container
      await new Promise((resolve) => setTimeout(resolve, 0));

      this.readFile(filename, tabId)
        .then((datas: any) => {
          this.setTitleBar(filename);
          // Save data to tab for later retrieval - TabsContainerComponent will handle setDatas
          this.tabService.setTabData(tabId, datas);
          if (callbackDone) {
            callbackDone();
          }
        })
        .catch((error: any) => {
          console.warn(this.translate.instant('OPEN_FILE_ERROR'), error);
          this.closeFile();
          Toastify({
            text: this.translate.instant('OPEN_FILE_ERROR'),
            gravity: 'bottom',
            position: 'center',
            duration: 3000,
          }).showToast();
          this._fileLoaderSub.next(this.fileLoaderDatas);
        });
    }
  }

  readFile(filename: string, tabId?: string): any {
    // Always use readFileWithJsonTypeDetection to properly detect file type
    // based on content, regardless of file extension (json, khj, khcj)
    return this.readFileWithJsonTypeDetection(filename, tabId);
  }

  readFileWithJsonTypeDetection(
    filename: string,
    tabId?: string
  ): Promise<any> {
    this.fileLoaderDatas!.datas = undefined;
    this.fileLoaderDatas!.isLoadingDatas = true;
    this.fileLoaderDatas!.isBigJsonFile = false;
    this.fileLoaderDatas!.loadingInfo = '';
    this._fileLoaderSub.next(this.fileLoaderDatas);

    return new Promise((resolve, reject) => {
      this.electronService.fs.readFile(
        filename,
        'utf-8',
        (errReadFile: NodeJS.ErrnoException, datas: string) => {
          if (errReadFile) {
            this.fileLoaderDatas!.isLoadingDatas = false;
            this._fileLoaderSub.next(this.fileLoaderDatas);
            reject(errReadFile);
          } else {
            try {
              const parsedDatas = JSON.parse(datas);
              parsedDatas.filename = filename;

              // Detect component type based on the tool field
              const tool = parsedDatas.tool;
              let componentType: 'visualization' | 'covisualization' =
                'visualization';

              if (tool === 'Khiops Coclustering') {
                componentType = 'covisualization';
              }

              // Update the tab's component type - do this BEFORE resolving
              // so the correct component is created before setDatas is called
              if (tabId) {
                this.tabService.updateTabComponentType(tabId, componentType);
              }

              this.fileLoaderDatas!.datas = parsedDatas;
              this.fileLoaderDatas!.isLoadingDatas = false;
              this._fileLoaderSub.next(this.fileLoaderDatas);

              resolve(parsedDatas);
            } catch (e) {
              this.fileLoaderDatas!.isLoadingDatas = false;
              this._fileLoaderSub.next(this.fileLoaderDatas);
              reject(e);
            }
          }
        }
      );
    });
  }

  closeFile() {
    this.initialize();
    this.ngzone.run(() => {
      this.configService.setDatas();
      this.setTitleBar('');
    });
  }

  setFileHistory(filename: string) {
    let filesHistory = this.storageService.getOne('OPEN_FILE');
    if (filesHistory) {
      const isExistingHistoryIndex = filesHistory.files.indexOf(filename);

      if (isExistingHistoryIndex !== -1) {
        // remove at index
        filesHistory.files.splice(isExistingHistoryIndex, 1);
      } else {
        // remove last item
        if (filesHistory.files.length >= 5) {
          filesHistory.files.splice(-1, 1);
        }
      }
    } else {
      filesHistory = {
        files: [],
      };
    }
    // add to the top of the list
    filesHistory.files.unshift(filename);
    this.storageService.setOne('OPEN_FILE', filesHistory);
  }

  getFileHistory() {
    const filesHistory = this.storageService.getOne('OPEN_FILE');
    return (
      filesHistory || {
        files: [],
      }
    );
  }

  save(datas: any) {
    this.saveFile(this.currentFilePath, datas);
  }

  saveAs(datas: any) {
    const dialogOpts: any = {
      defaultPath: '',
      filters: [
        {
          name: 'json',
          extensions: ['khcj', 'json'],
        },
      ],
    };
    this.electronService.dialog
      .showSaveDialog(dialogOpts)
      .then((result: any) => {
        const filename = result.filePath;
        if (filename) {
          this.saveFile(filename, datas);
        }
      });
  }

  saveFile(filename: string, datas: any) {
    this.electronService.fs.writeFileSync(
      filename,
      JSON.stringify(datas, null, 2), // spacing level = 2
      'utf-8'
    );
    this.configService.snack(
      this.translate.instant('GLOBAL_SNACKS_SAVE_FILE_SUCCESS'),
      4000,
      'success'
    );
  }
}
