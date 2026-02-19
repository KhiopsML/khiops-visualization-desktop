/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable, NgZone } from '@angular/core';
import { ElectronService } from './electron.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfigService } from './config.service';
import { BehaviorSubject, Observable } from 'rxjs';
// @ts-ignore
import Toastify from 'toastify-js';
import { StorageService } from './storage.service';
import { FileLoaderI } from '../../interfaces/file-system';

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

  private _fileLoaderSub: BehaviorSubject<any> = new BehaviorSubject(undefined);
  public fileLoader$: Observable<any> = this._fileLoaderSub.asObservable();

  constructor(
    private ngzone: NgZone,
    private configService: ConfigService,
    private electronService: ElectronService,
    private translate: TranslateService,
    private storageService: StorageService,
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
          title: title,
        });
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  async openFile(filename: string, callbackDone?: Function) {
    if (filename) {
      // Check if we need to save current work before opening new file
      const currentActiveType = this.configService.getActiveComponentType();
      const hasCurrentFile =
        this.currentFilePath && this.currentFilePath !== '';

      if (hasCurrentFile && currentActiveType === 'covisualization') {
        this.handleSaveBeforeAction(async () => {
          await this.performOpenFile(filename, callbackDone);
        });
      } else {
        await this.performOpenFile(filename, callbackDone);
      }
    }
  }

  private async performOpenFile(filename: string, callbackDone?: Function) {
    // For JSON files, read and analyze content first to determine component type
    const extension = filename.toLowerCase().split('.').pop();
    let jsonData: any = null;
    let componentType: 'visualization' | 'covisualization' = 'visualization';

    if (extension === 'json') {
      try {
        const content = await this.readFileContent(filename);
        jsonData = JSON.parse(content);
      } catch (error) {
        console.warn('Error pre-reading JSON file for analysis:', error);
      }
    } else if (extension === 'khcj') {
      componentType = 'covisualization';
    } else if (extension === 'khj') {
      componentType = 'visualization';
    }

    await this.configService.requestComponentChange(filename, jsonData);
    this.configService.setDatas();

    this.readFile(filename)
      .then((datas: any) => {
        this.setTitleBar(filename, componentType);
        this.setFileHistory(filename);
        // Add small delay to ensure component is fully rendered before setting data
        setTimeout(() => {
          this.configService.setDatas(datas);
          if (callbackDone) {
            callbackDone();
          }
        }, 250);
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
  private readFileContent(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.electronService.fs.readFile(
        filename,
        'utf-8',
        (err: any, data: string) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
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
        } else {
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
                  this.fileLoaderDatas!.isBigJsonFile = true;
                  this.fileLoaderDatas!.loadingInfo = '';
                  this._fileLoaderSub.next(this.fileLoaderDatas);

                  const currentDatas: any = {};
                  const stream = this.electronService.fs.createReadStream(
                    filename,
                    {
                      encoding: 'utf8',
                    },
                  );
                  const getStream = stream.pipe(
                    jsonStream.parse([
                      {
                        emitKey: true,
                      },
                    ]),
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
                    .on('error', () => {
                      reject();
                    });
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
        }
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
        } else {
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
                  console.error(
                    'JSON parsing error in covisualization file:',
                    e,
                  );
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
        }
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
          const datasToSave = this.configService
            .getConfig()
            .constructDatasToSave();
          this.saveFile(this.currentFilePath, datasToSave);
          this.storageService.saveAll(() => {
            finalAction();
          });
        } else if (e === 'cancel') {
          return;
        } else if (e === 'reject') {
          this.storageService.saveAll(() => {
            finalAction();
          });
        }
      });
    } else {
      this.storageService.saveAll(() => {
        finalAction();
      });
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
      'utf-8',
    );
    this.configService.snack(
      this.translate.instant('GLOBAL_SNACKS_SAVE_FILE_SUCCESS'),
      4000,
      'success',
    );
  }
}
