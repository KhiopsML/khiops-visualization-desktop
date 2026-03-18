/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable, NgZone } from '@angular/core';
import { ElectronService } from './electron.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfigService } from './config.service';
import { TabManagerService } from './tab-manager.service';
import { BehaviorSubject, Observable } from 'rxjs';
import Toastify from 'toastify-js';
import { StorageService } from './storage.service';
import { FileLoaderI } from '../../interfaces/file-system.interface';
import {
  JsonFormatterService,
  JsonFormatState,
} from './json-formatter.service';

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
  fileLoaderDatas?: FileLoaderI;
  currentFilePath = '';

  /** Format state captured when the file was opened – reused on save. */
  private jsonFormatState: JsonFormatState | null = null;

  private _fileLoaderSub: BehaviorSubject<any> = new BehaviorSubject(undefined);
  public fileLoader$: Observable<any> = this._fileLoaderSub.asObservable();

  // Subject emitted when recent files list changes
  private _recentFilesChanged = new BehaviorSubject<void>(undefined);
  public recentFilesChanged$: Observable<void> =
    this._recentFilesChanged.asObservable();

  constructor(
    private ngzone: NgZone,
    private configService: ConfigService,
    private electronService: ElectronService,
    private translate: TranslateService,
    private storageService: StorageService,
    private jsonFormatterService: JsonFormatterService,
    private tabManagerService: TabManagerService,
  ) {
    this.initialize();
  }

  /**
   * Initialize file loader data to default state when no file is loaded
   * or when a file is closed. This ensures that the application state is reset
   * and ready for a new file to be loaded without residual data from previous files.
   */
  initialize() {
    this.fileLoaderDatas = {
      isLoadingDatas: false,
      datas: undefined,
      isBigJsonFile: false,
      loadingInfo: '',
    };
  }

  /**
   * Open a file dialog for the user to select a file.
   * @param callbackDone A callback function to be executed after a file is selected and opened.
   */
  openFileDialog(callbackDone: Function) {
    // this.trackerService.trackEvent('click', 'open_file');
    const associationFiles = ['json'];
    associationFiles.push('khj');
    associationFiles.push('khcj');

    this.electronService.dialog
      .showOpenDialog(null, {
        properties: ['openFile'],
        filters: [{ extensions: associationFiles }],
      })
      .then((result: Electron.OpenDialogReturnValue) => {
        if (result && !result.canceled && result.filePaths) {
          this.openFile(result.filePaths[0], callbackDone);
        }
      })
      .catch((err: any) => console.log(err));
  }

  /**
   * Set the title bar of the application window.
   * @param filepath The path of the currently opened file.
   * @param componentType The type of the active component ('visualization' or 'covisualization').
   */
  setTitleBar(
    filepath: string,
    componentType?: 'visualization' | 'covisualization',
  ) {
    this.currentFilePath = filepath;
    (async () => {
      try {
        const appType = 'Khiops Visualization Desktop';
        const title = filepath ? appType + ' ' + filepath : appType;
        await this.electronService.ipcRenderer?.invoke('set-title-bar-name', {
          title,
        });
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  async openFile(filename: string, callbackDone?: Function, tabId?: string) {
    if (!filename) return;

    // Determine component type from filename
    const extension = filename.toLowerCase().split('.').pop();
    let componentType: 'visualization' | 'covisualization' = 'visualization';
    if (extension === 'khcj') {
      componentType = 'covisualization';
    }

    // Check if file is already open - if so, just activate the tab
    const existingTab = this.tabManagerService.getTabByFilePath(filename);
    if (existingTab) {
      this.tabManagerService.setActiveTab(existingTab.id);
      callbackDone && callbackDone();
      return;
    }

    // Create a new tab if no tabId provided
    let finalTabId = tabId;
    if (!finalTabId) {
      finalTabId = this.tabManagerService.openFileInTab(
        filename,
        componentType,
      );
    }

    // Check if we need to save current work before opening new file
    const currentActiveType = this.configService.getActiveComponentType();
    const hasCurrentFile = this.currentFilePath && this.currentFilePath !== '';

    if (hasCurrentFile && currentActiveType === 'covisualization') {
      this.handleSaveBeforeAction(async () => {
        await this.performOpenFile(filename, callbackDone, finalTabId);
      });
    } else {
      await this.performOpenFile(filename, callbackDone, finalTabId);
    }
  }

  private async performOpenFile(
    filename: string,
    callbackDone?: Function,
    tabId?: string,
  ) {
    // For JSON files, read and analyze content first to determine component type
    const extension = filename.toLowerCase().split('.').pop();
    let jsonData: any = null;
    let rawContent: string | null = null;
    let componentType: 'visualization' | 'covisualization' = 'visualization';

    if (extension === 'json' || extension === 'khj' || extension === 'khcj') {
      try {
        rawContent = await this.readFileContent(filename);
        jsonData = JSON.parse(rawContent);
      } catch (error) {
        console.warn('Error pre-reading JSON file for analysis:', error);
      }
    }

    if (extension === 'khcj') {
      componentType = 'covisualization';
    } else if (extension === 'khj') {
      componentType = 'visualization';
    }

    // Capture format state from the raw source
    if (rawContent) {
      this.jsonFormatState =
        this.jsonFormatterService.analyzeJsonFormat(rawContent);
    } else {
      this.jsonFormatState = null;
    }

    await this.configService.requestComponentChange(filename, jsonData);
    this.configService.setDatas();

    this.readFile(filename)
      .then((datas: any) => {
        this.setTitleBar(filename, componentType);
        this.setFileHistory(filename);
        // Add delay to ensure component is fully configured before setting data
        setTimeout(() => {
          if (tabId) {
            // Send data to specific tab - use compatible data format
            const dataWithFilename = { ...datas, filename: filename };
            this.configService.notifyTabData(tabId, dataWithFilename);
            // Mark tab as loaded
            this.tabManagerService.updateTab(tabId, { isLoading: false });
          } else {
            // Fallback to global setDatas
            this.configService.setDatas(datas);
          }
          if (callbackDone) callbackDone();
        }, 750); // Longer delay for Shadow DOM components
      })
      .catch((error: any) => {
        console.warn(this.translate.instant('OPEN_FILE_ERROR'), error);
        this.closeFile();
        // Mark tab as finished loading (even on error)
        if (tabId) {
          this.tabManagerService.updateTab(tabId, { isLoading: false });
        }
        Toastify({
          text: this.translate.instant('OPEN_FILE_ERROR'),
          gravity: 'bottom',
          position: 'center',
          duration: 3000,
        }).showToast();
        this._fileLoaderSub.next(this.fileLoaderDatas);
      });
  }

  private readFileContent(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.electronService.fs.readFile(
        filename,
        'utf-8',
        (err: any, data: string) => {
          if (err) reject(err);
          else resolve(data);
        },
      );
    });
  }

  /**
   * Reads a file and returns its content. If the file is a large JSON file, it uses streaming to read and parse the content without blocking the UI.
   * @param filename The path of the file to be read.
   * @returns A promise that resolves with the file content or rejects with an error.
   */
  readFile(filename: string): any {
    const activeComponentType = this.configService.getActiveComponentType();

    if (activeComponentType === 'covisualization') {
      return this.readFileSimple(filename);
    }

    this.fileLoaderDatas!.datas = undefined;
    this.fileLoaderDatas!.isLoadingDatas = true;
    this.fileLoaderDatas!.isBigJsonFile = false;
    this._fileLoaderSub.next(this.fileLoaderDatas);

    return new Promise((resolve, reject) => {
      this.electronService.fs.stat(filename, (err: any) => {
        if (err) {
          reject();
          return;
        }

        this.electronService.fs.readFile(
          filename,
          'utf-8',
          (errReadFile: NodeJS.ErrnoException, datas: string) => {
            if (errReadFile) {
              if (
                errReadFile
                  .toString()
                  .startsWith('Error: Cannot create a string longer')
              ) {
                // Streaming for very large files
                this.fileLoaderDatas!.isBigJsonFile = true;
                this.fileLoaderDatas!.loadingInfo = '';
                this._fileLoaderSub.next(this.fileLoaderDatas);

                const currentDatas: any = {};
                const stream = this.electronService.fs.createReadStream(
                  filename,
                  { encoding: 'utf8' },
                );
                const getStream = stream.pipe(
                  jsonStream.parse([{ emitKey: true }]),
                );

                getStream.pipe(
                  es.map((pipeDatas: any) => {
                    this.fileLoaderDatas!.loadingInfo = pipeDatas.key;
                    currentDatas[pipeDatas.key] = pipeDatas.value;
                    this._fileLoaderSub.next(this.fileLoaderDatas);
                  }),
                );

                getStream
                  .on('end', () => {
                    this.fileLoaderDatas!.datas = currentDatas;
                    this.fileLoaderDatas!.datas.filename = filename;
                    this.fileLoaderDatas!.isLoadingDatas = false;
                    this._fileLoaderSub.next(this.fileLoaderDatas);
                    resolve(this.fileLoaderDatas?.datas);
                  })
                  .on('error', () => reject());
              } else {
                this.fileLoaderDatas!.isLoadingDatas = false;
                this._fileLoaderSub.next(this.fileLoaderDatas);
                reject(errReadFile);
              }
            } else {
              this.fileLoaderDatas!.isLoadingDatas = false;
              try {
                this.fileLoaderDatas!.datas = JSON.parse(datas);

                // Validate JSON structure based on file extension and content
                const extension = filename.toLowerCase().split('.').pop();
                const jsonData = this.fileLoaderDatas!.datas;

                if (extension === 'json') {
                  // Additional validation for generic JSON files
                  if (!jsonData.tool) {
                    console.warn('JSON file missing required "tool" field');
                  } else if (
                    jsonData.tool === 'Khiops Coclustering' &&
                    !jsonData.coclusteringReport
                  ) {
                    console.warn(
                      'Khiops Coclustering JSON file missing coclusteringReport structure',
                    );
                  } else if (
                    jsonData.tool === 'Khiops' &&
                    (!jsonData.modelingReport ||
                      jsonData.modelingReport.reportType !== 'Modeling')
                  ) {
                    console.warn(
                      'Khiops JSON file missing proper modelingReport structure',
                    );
                  }
                }

                this.fileLoaderDatas!.datas.filename = filename;
                this._fileLoaderSub.next(this.fileLoaderDatas);
                resolve(this.fileLoaderDatas?.datas);
              } catch (e) {
                console.error('JSON parsing error:', e);
                Toastify({
                  text:
                    this.translate.instant('OPEN_FILE_ERROR') +
                    ' - Invalid JSON format',
                  gravity: 'bottom',
                  position: 'center',
                  duration: 3000,
                }).showToast();
                this._fileLoaderSub.next(this.fileLoaderDatas);
                this.closeFile();
                reject(e);
              }
            }
          },
        );
      });
    });
  }

  readFileSimple(filename: string): Promise<any> {
    this.fileLoaderDatas!.datas = undefined;
    this.fileLoaderDatas!.isLoadingDatas = true;
    this.fileLoaderDatas!.isBigJsonFile = false;
    this.fileLoaderDatas!.loadingInfo = '';
    this._fileLoaderSub.next(this.fileLoaderDatas);

    return new Promise((resolve, reject) => {
      this.electronService.fs.stat(filename, (err: any) => {
        if (err) {
          this.fileLoaderDatas!.isLoadingDatas = false;
          this._fileLoaderSub.next(this.fileLoaderDatas);
          reject(err);
          return;
        }

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

                // Validate covisualization JSON structure
                if (
                  parsedDatas.tool === 'Khiops Coclustering' &&
                  !parsedDatas.coclusteringReport
                ) {
                  console.warn(
                    'Covisualization file missing expected coclusteringReport structure',
                  );
                }

                parsedDatas.filename = filename;
                this.fileLoaderDatas!.datas = parsedDatas;
                this.fileLoaderDatas!.isLoadingDatas = false;
                this._fileLoaderSub.next(this.fileLoaderDatas);
                resolve(parsedDatas);
              } catch (e) {
                console.error('JSON parsing error in covisualization file:', e);
                this.fileLoaderDatas!.isLoadingDatas = false;
                this._fileLoaderSub.next(this.fileLoaderDatas);
                Toastify({
                  text:
                    this.translate.instant('OPEN_FILE_ERROR') +
                    ' - Invalid JSON format',
                  gravity: 'bottom',
                  position: 'center',
                  duration: 3000,
                }).showToast();
                reject(e);
              }
            }
          },
        );
      });
    });
  }

  /**
   * Generic method to handle save before action logic for covisualization mode
   * @param finalAction The action to execute after save/cancel operations
   */
  handleSaveBeforeAction(finalAction: () => void | Promise<void>) {
    const activeComponentType = this.configService.getActiveComponentType();
    const hasCurrentFile = this.currentFilePath && this.currentFilePath !== '';

    if (activeComponentType === 'covisualization' && hasCurrentFile) {
      this.configService.openSaveBeforeQuitDialog((e: string) => {
        if (e === 'confirm') {
          const config = this.configService.getConfig();
          if (config && config.constructDatasToSave) {
            const datasToSave = config.constructDatasToSave();
            this.saveFile(this.currentFilePath, datasToSave);
            this.storageService.saveAll(() => finalAction());
          }
        } else if (e === 'cancel') {
          return;
        } else if (e === 'reject') {
          this.storageService.saveAll(() => finalAction());
        }
      });
    } else {
      this.storageService.saveAll(() => finalAction());
    }
  }

  closeFile(callbackDone?: Function) {
    this.handleSaveBeforeAction(() => {
      this.performCloseFile();
      callbackDone && callbackDone();
    });
  }

  private performCloseFile() {
    this.initialize();
    this.ngzone.run(() => {
      this.configService.setDatas();
      this.setTitleBar('');
      this._fileLoaderSub.next(this.fileLoaderDatas);
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
        if (filesHistory.files.length >= 10) {
          filesHistory.files.splice(-1, 1);
        }
      }
    } else {
      filesHistory = { files: [] };
    }
    // add to the top of the list
    filesHistory.files.unshift(filename);
    this.storageService.setOne('OPEN_FILE', filesHistory);

    // Emit signal that recent files list has changed
    this._recentFilesChanged.next();
  }

  getFileHistory() {
    return this.storageService.getOne('OPEN_FILE') || { files: [] };
  }

  getRecentFiles() {
    const fileHistory = this.getFileHistory();
    const path = this.electronService.isElectron
      ? window.require('path')
      : null;

    // Work with the existing format: {files: Array of strings}
    const filesArray = fileHistory.files || [];

    return filesArray.map((filePath: string, index: number) => {
      let filename = filePath;
      if (path && typeof filePath === 'string') {
        filename = path.basename(filePath);
      }

      // Get file size
      let fileSize = 0;
      try {
        const stats = this.electronService.fs.statSync(filePath);
        fileSize = stats.size;
      } catch (error) {
        console.warn('Could not get file size for:', filePath, error);
      }

      // Determine file type based on extension
      const fileType = this.getFileType(filePath);

      return {
        path: filePath,
        filename: filename,
        size: fileSize,
        sizeDisplay: this.formatFileSize(fileSize),
        fileType: fileType,
      };
    });
  }

  /**
   * Determine file type based on extension and file content
   */
  private getFileType(filePath: string): 'visualization' | 'covisualization' {
    const extension = filePath.toLowerCase().split('.').pop();

    if (extension === 'khcj') {
      return 'covisualization';
    } else if (extension === 'khj') {
      return 'visualization';
    } else if (extension === 'json') {
      // For .json files, we need to check the content to determine the type
      try {
        const content = this.electronService.fs.readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(content);

        if (jsonData.tool === 'Khiops Coclustering') {
          return 'covisualization';
        } else {
          return 'visualization';
        }
      } catch (error) {
        console.warn(
          'Could not read file content for type detection:',
          filePath,
          error,
        );
        return 'visualization'; // Default fallback
      }
    }

    return 'visualization'; // Default
  }

  /**
   * Format file size in human-readable format (B, KB, MB, GB)
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  save(datas: any) {
    this.saveFile(this.currentFilePath, datas);
  }

  saveAs(datas: any) {
    const dialogOpts: any = {
      defaultPath: '',
      filters: [{ name: 'json', extensions: ['khcj', 'json'] }],
    };
    this.electronService.dialog
      .showSaveDialog(dialogOpts)
      .then((result: any) => {
        const filename = result.filePath;
        if (filename) this.saveFile(filename, datas);
      });
  }

  saveFile(filename: string, datas: any) {
    const serialized = this.jsonFormatState
      ? this.jsonFormatterService.serializeWithFormatState(
          datas,
          this.jsonFormatState,
        )
      : JSON.stringify(datas, null, 2);

    this.electronService.fs.writeFileSync(filename, serialized, 'utf-8');
    this.configService.snack(
      this.translate.instant('GLOBAL_SNACKS_SAVE_FILE_SUCCESS'),
      4000,
      'success',
    );
  }
}
