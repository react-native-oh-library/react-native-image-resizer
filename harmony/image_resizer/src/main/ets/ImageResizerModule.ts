/**
 * MIT License
 *
 * Copyright (C) 2024 Huawei Device Co., Ltd.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHTHOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { TurboModule } from '@rnoh/react-native-openharmony/ts';
import { TM } from "@rnoh/react-native-openharmony/generated/ts";
import image from '@ohos.multimedia.image';
import { buffer, util } from '@kit.ArkTS';
import fs from '@ohos.file.fs';
import Logger from './Logger';

export class ImageResizerModule extends TurboModule implements TM.ImageResizer.Spec {
  private size: number = 0;
  private name: string = '';
  private base64: string = '';
  private filePath: string = '';
  private fileUri: string = '';
  private finalWidth: number = 0;
  private finalHeight: number = 0;

  async createResizedImage(uri: string, width: number, height: number, format: string, quality: number, mode: string,
    onlyScaleDown: boolean, rotation: number, outputPath: string | null, keepMeta: boolean): Promise<{
    path: string;
    uri: string;
    size: number;
    name: string;
    width: number;
    height: number;
    base64: string;
  }> {
    let i = uri.lastIndexOf('/')
    let dir = uri.substring(0, i);
    let file;
    if (dir == this.ctx.uiAbilityContext.cacheDir + this.getDir(uri) || dir == 'file://' + this.ctx.uiAbilityContext.cacheDir + this.getDir(uri)) {
      file = fs.openSync(uri, fs.OpenMode.CREATE);
    } else {
      await fs.copy(uri, this.getCacheFilePath(format, uri));
      file = fs.openSync(this.getCacheFilePath(format, uri), fs.OpenMode.CREATE);
    }

    await this.getImageSize(uri, file.fd, rotation, mode, width, height, onlyScaleDown, format, quality, keepMeta);
    this.fileUri = 'file://' + this.filePath;
    let newFile = fs.openSync(this.fileUri, fs.OpenMode.CREATE);
    this.size = this.getFileSize(newFile.fd);
    this.name = this.getImgName(this.fileUri)

    if (outputPath) {
      this.filePath = this.copyFileToPath(newFile.fd, outputPath, format);
      this.fileUri = 'file://' + this.filePath;
    }

    fs.closeSync(file);
    fs.closeSync(newFile);

    return new Promise<{
      path: string;
      uri: string;
      size: number;
      name: string;
      width: number;
      height: number;
      base64: string;
    }>((resolve, reject) => {

      let data = {
        path: this.filePath,
        uri: this.fileUri,
        size: this.size,
        name: this.name,
        width: this.finalWidth,
        height: this.finalHeight,
        base64: this.base64
      }

      if (data) {
        resolve(data);
      } else {
        reject(data);
      }
    });
  }

  private async getImageSize(uri: string, fd: number, rotation: number, mode: string, width: number, height: number,
    onlyScaleDown: boolean, format: string, quality: number, keepMeta: boolean) {
    let imageIS = image.createImageSource(fd)
    let imagePM = await imageIS.createPixelMap({ editable: true });
    let imgInfo = await imagePM.getImageInfo();
    let oldWidth = imgInfo.size.width;
    let oldHeight = imgInfo.size.height;

    if (height > 0 && width > 0) {
      if (mode == "stretch") {
        // Distort aspect ratio
        this.finalWidth = width;
        this.finalHeight = height;

        if (onlyScaleDown) {
          this.finalWidth = Math.min(oldWidth, this.finalWidth);
          this.finalHeight = Math.min(oldHeight, this.finalHeight);
        }
      } else {
        // "contain" (default) or "cover": keep its aspect ratio
        let widthRatio = width / oldWidth;
        let heightRatio = height / oldHeight;
        let ratio;
        if (mode == "cover") {
          ratio = Math.max(widthRatio, heightRatio);
        } else {
          ratio = Math.min(widthRatio, heightRatio);
        }

        if (onlyScaleDown) {
          ratio = Math.min(ratio, 1);
        }
        this.finalWidth = Math.round(oldWidth * ratio);
        this.finalHeight = Math.round(oldHeight * ratio);
      }
    }

    let xScale = Number((this.finalWidth / oldWidth).toFixed(5));
    let yScale = Number((this.finalHeight / oldHeight).toFixed(5));

    this.filePath = this.getCacheFilePath(format, uri);
    try {
      await imagePM.rotate(rotation);
      await imagePM.scale(xScale, yScale);
      const imagePackerApi: image.ImagePacker = image.createImagePacker();
      const file = fs.openSync(this.filePath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
      let newFormat = "image/" + format;
      let buf = await imagePackerApi.packing(imagePM, { format: newFormat, quality: quality });
      this.base64 = buffer.from(buf).toString('base64');
      await fs.write(file.fd, buf);
      fs.closeSync(file.fd);
    } catch (err) {
      Logger.error("getImageSize error = " + JSON.stringify(err));
    }

    if (keepMeta) {
      let key: Array<image.PropertyKey> = [];
      for (let name in image.PropertyKey) {
        key.push(("image.PropertyKey." + name) as image.PropertyKey);
      }

      try {
        let data = await imageIS.getImageProperties(key);
        let imageISNew = image.createImageSource(this.filePath)

        await imageISNew.modifyImageProperties(data);

        await imageISNew.release();
        imageISNew = undefined;
      } catch (err) {
        Logger.error("modifyImageProperties error = " + JSON.stringify(err));
      }
    }

    await imagePM.release();
    imagePM = undefined;

    await imageIS.release();
    imageIS = undefined;

  }

  private getDir(uri: string) {
    let i = uri.lastIndexOf('/');
    let cacheDirLength = this.ctx.uiAbilityContext.cacheDir.length;
    let fileDir = uri.substring(0, i);
    let mimeUri = uri.substring(0, 4)
    let dir;
    if (mimeUri === 'file') {
      dir = fileDir.substring('file://'.length + cacheDirLength);
    } else {
      dir = fileDir.substring(cacheDirLength);
    }
    return dir;
  }

  private getCacheFilePath(format: string, uri: string) {
    return this.ctx.uiAbilityContext.cacheDir + this.getDir(uri) +'/rn_image_resizer_lib_temp_' + util.generateRandomUUID(true) + '.' +
      format;
  }

  private copyFileToPath(fd: number, path: string, format: string) {
    try {
      fs.copyFileSync(fd, path, 0)
      return path + '/rn_image_resizer_lib_temp_' + util.generateRandomUUID(true) + '.' + format;
    } catch (e) {
      Logger.info('复制文件失败!', JSON.stringify(e));
    }
  }

  private getFileSize(fd: number) {
    let stat = fs.statSync(fd);
    return stat.size;
  }

  private getImgName(imgUri: string) {
    const mimeUri = imgUri.substring(0, 4)
    let fileName;
    if (mimeUri === 'file') {
      let i = imgUri.lastIndexOf('/')
      fileName = imgUri.substring(i + 1);
    }
    return fileName;
  }
}