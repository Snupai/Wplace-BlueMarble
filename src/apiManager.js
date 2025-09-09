/** ApiManager class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @class ApiManager
 * @since 0.11.1
 */

import TemplateManager from "./templateManager.js";
import { escapeHTML, numberToEncoded, serverTPtoDisplayTP, colorpalette } from "./utils.js";

export default class ApiManager {

  /** Constructor for ApiManager class
   * @param {TemplateManager} templateManager 
   * @since 0.11.34
   */
  constructor(templateManager) {
    this.templateManager = templateManager;
    this.disableAll = false; // Should the entire userscript be disabled?
    this.coordsTilePixel = []; // Contains the last detected tile/pixel coordinate pair requested
    this.templateCoordsTilePixel = []; // Contains the last "enabled" template coords
    this.tileBlobs = new Map(); // Cache of rendered tile blobs keyed by "x,y"
  }

  /** Determines if the spontaneously received response is something we want.
   * Otherwise, we can ignore it.
   * Note: Due to aggressive compression, make your calls like `data['jsonData']['name']` instead of `data.jsonData.name`
   * 
   * @param {Overlay} overlay - The Overlay class instance
   * @since 0.11.1
  */
  spontaneousResponseListener(overlay) {

    // Triggers whenever a message is sent
    window.addEventListener('message', async (event) => {

      const data = event.data; // The data of the message
      const dataJSON = data['jsonData']; // The JSON response, if any

      // Kills itself if the message was not intended for earthrise
      if (!(data && data['source'] === 'blue-marble')) {return;}

      // Kills itself if the message has no endpoint (intended for earthrise, but not this function)
      if (!data['endpoint']) {return;}

      // Trims endpoint to the second to last non-number, non-null directoy.
      // E.g. "wplace.live/api/pixel/0/0?payload" -> "pixel"
      // E.g. "wplace.live/api/files/s0/tiles/0/0/0.png" -> "tiles"
      const endpointText = data['endpoint']?.split('?')[0].split('/').filter(s => s && isNaN(Number(s))).filter(s => s && !s.includes('.')).pop();

      console.log(`%cearthrise%c: Recieved message about "%s"`, 'color: cornflowerblue;', '', endpointText);

      // Each case is something that earthrise can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (endpointText) {

        case 'me': // Request to retrieve user data

          // If the game can not retrieve the userdata...
          if (dataJSON['status'] && dataJSON['status']?.toString()[0] != '2') {
            // The server is probably down (NOT a 2xx status)
            
            overlay.handleDisplayError(`You are not logged in!\nCould not fetch userdata.`);
            return; // Kills itself before attempting to display null userdata
          }

          const nextLevelPixels = Math.ceil(Math.pow(Math.floor(dataJSON['level']) * Math.pow(30, 0.65), (1/0.65)) - dataJSON['pixelsPainted']); // Calculates pixels to the next level

          console.log(dataJSON['id']);
          if (!!dataJSON['id'] || dataJSON['id'] === 0) {
            console.log(numberToEncoded(
              dataJSON['id'],
              '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'
            ));
          }
          this.templateManager.userID = dataJSON['id'];
          
          overlay.updateInnerHTML('bm-user-name', `Username: <b>${escapeHTML(dataJSON['name'])}</b>`); // Updates the text content of the username field
          overlay.updateInnerHTML('bm-user-droplets', `Droplets: <b>${new Intl.NumberFormat().format(dataJSON['droplets'])}</b>`); // Updates the text content of the droplets field
          overlay.updateInnerHTML('bm-user-nextlevel', `Next level in <b>${new Intl.NumberFormat().format(nextLevelPixels)}</b> pixel${nextLevelPixels == 1 ? '' : 's'}`); // Updates the text content of the next level field
          break;

        case 'pixel': // Request to retrieve pixel data
          const coordsTile = data['endpoint'].split('?')[0].split('/').filter(s => s && !isNaN(Number(s))); // Retrieves the tile coords as [x, y]
          const payloadExtractor = new URLSearchParams(data['endpoint'].split('?')[1]); // Declares a new payload deconstructor and passes in the fetch request payload
          const coordsPixel = [payloadExtractor.get('x'), payloadExtractor.get('y')]; // Retrieves the deconstructed pixel coords from the payload
          
          // Don't save the coords if there are previous coords that could be used
          if (this.coordsTilePixel.length && (!coordsTile.length || !coordsPixel.length)) {
            overlay.handleDisplayError(`Coordinates are malformed!\nDid you try clicking the canvas first?`);
            return; // Kills itself
          }
          
          this.coordsTilePixel = [...coordsTile, ...coordsPixel]; // Combines the two arrays such that [x, y, x, y]
          const displayTP = serverTPtoDisplayTP(coordsTile, coordsPixel);
          
          // Auto color picking functionality
          await this.#performAutoColorPicking(coordsTile, coordsPixel);
          
          const spanElements = document.querySelectorAll('span'); // Retrieves all span elements

          // For every span element, find the one we want (pixel numbers when canvas clicked)
          for (const element of spanElements) {
            if (element.textContent.trim().includes(`${displayTP[0]}, ${displayTP[1]}`)) {

              let displayCoords = document.querySelector('#bm-display-coords'); // Find the additional pixel coords span

              const text = `(Tl X: ${coordsTile[0]}, Tl Y: ${coordsTile[1]}, Px X: ${coordsPixel[0]}, Px Y: ${coordsPixel[1]})`;
              
              // If we could not find the addition coord span, we make it then update the textContent with the new coords
              if (!displayCoords) {
                displayCoords = document.createElement('span');
                displayCoords.id = 'bm-display-coords';
                displayCoords.textContent = text;
                displayCoords.style = 'margin-left: calc(var(--spacing)*3); font-size: small;';
                element.parentNode.parentNode.parentNode.insertAdjacentElement('afterend', displayCoords);
              } else {
                displayCoords.textContent = text;
              }
            }
          }
          break;
        
        case 'tiles':

          // Runs only if the tile has the template
          let tileCoordsTile = data['endpoint'].split('/');
          tileCoordsTile = [parseInt(tileCoordsTile[tileCoordsTile.length - 2]), parseInt(tileCoordsTile[tileCoordsTile.length - 1].replace('.png', ''))];

          const blobUUID = data['blobID'];
          const blobData = data['blobData'];

          // Cache the raw tile image for area capture
          try {
            this.tileBlobs.set(`${tileCoordsTile[0]},${tileCoordsTile[1]}`, blobData);
          } catch (_) {}

          const templateBlob = await this.templateManager.drawTemplateOnTile(blobData, tileCoordsTile);

          window.postMessage({
            source: 'blue-marble',
            blobID: blobUUID,
            blobData: templateBlob,
            blink: data['blink']
          });
          break;

        case 'robots': // Request to retrieve what script types are allowed
          this.disableAll = dataJSON['userscript']?.toString().toLowerCase() == 'false'; // Disables earthrise if site owner wants userscripts disabled
          break;
      }
    });
  }

  /** Performs auto color picking when clicking on a pixel that should be painted from template
   * @param {string[]} coordsTile - The tile coordinates [x, y]
   * @param {string[]} coordsPixel - The pixel coordinates [x, y]
   * @since 1.0.0
   */
  async #performAutoColorPicking(coordsTile, coordsPixel) {
    try {
      // Check if we have active templates
      if (!this.templateManager?.templatesArray?.length) {
        return; // No templates active, nothing to pick
      }

      const activeTemplate = this.templateManager.templatesArray[0];
      if (!activeTemplate?.chunked) {
        return; // No template data available
      }

      // Convert coordinates to numbers
      const tileX = parseInt(coordsTile[0]);
      const tileY = parseInt(coordsTile[1]);  
      const pixelX = parseInt(coordsPixel[0]);
      const pixelY = parseInt(coordsPixel[1]);

      // Format tile coordinates for template lookup
      const tileKey = `${tileX.toString().padStart(4, '0')},${tileY.toString().padStart(4, '0')}`;
      
      // Find the template chunk that matches this pixel
      const templateChunkKey = Object.keys(activeTemplate.chunked).find(key => key.startsWith(tileKey));
      if (!templateChunkKey) {
        return; // No template data for this tile
      }

      // Get the template bitmap for this chunk
      const templateBitmap = activeTemplate.chunked[templateChunkKey];
      if (!templateBitmap) {
        return;
      }

      // Extract the pixel coordinates within the chunk
      const chunkCoords = templateChunkKey.split(',');
      const chunkPixelX = parseInt(chunkCoords[2]);
      const chunkPixelY = parseInt(chunkCoords[3]);
      
      // Calculate the pixel position within the template bitmap
      const drawMult = this.templateManager.drawMult || 3;
      const localX = (pixelX - chunkPixelX) * drawMult + 1; // +1 to get center pixel
      const localY = (pixelY - chunkPixelY) * drawMult + 1; // +1 to get center pixel

      // Create a canvas to read the pixel data
      const tempCanvas = new OffscreenCanvas(templateBitmap.width, templateBitmap.height);
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(templateBitmap, 0, 0);
      
      // Check if the coordinates are within bounds
      if (localX < 0 || localX >= templateBitmap.width || localY < 0 || localY >= templateBitmap.height) {
        return;
      }

      // Get the pixel data
      const imageData = tempCtx.getImageData(localX, localY, 1, 1);
      const [r, g, b, a] = imageData.data;

      // Skip transparent pixels
      if (a < 64) {
        return;
      }

      // Skip transparent template color (deface sentinel)
      if (r === 222 && g === 250 && b === 206) {
        return;
      }

      // Find the matching color in the palette
      const targetColor = colorpalette.find(color => 
        color.rgb[0] === r && color.rgb[1] === g && color.rgb[2] === b
      );

      if (targetColor) {
        // Auto-select the color by simulating a click on the color palette
        this.#selectColor(targetColor.id);
        console.log(`Auto-picked color #${targetColor.id} (${targetColor.name}) for pixel at ${tileX},${tileY}:${pixelX},${pixelY}`);
      }

    } catch (error) {
      console.warn('Auto color picking failed:', error);
    }
  }

  /** Selects a color in the color palette UI
   * @param {number} colorId - The ID of the color to select
   * @since 1.0.0
   */
  #selectColor(colorId) {
    try {
      // Look for the color element by ID
      const colorElement = document.querySelector(`#color-${colorId}`);
      if (colorElement) {
        colorElement.click();
        return;
      }

      // Fallback: look for elements with the color as background
      const colorData = colorpalette.find(c => c.id === colorId);
      if (!colorData) return;

      const [r, g, b] = colorData.rgb;
      const targetRgb = `rgb(${r}, ${g}, ${b})`;
      
      // Find element by background color
      const allColorElements = document.querySelectorAll('[id^="color-"]');
      for (const element of allColorElements) {
        const bgColor = window.getComputedStyle(element).backgroundColor;
        if (bgColor === targetRgb) {
          element.click();
          return;
        }
      }

    } catch (error) {
      console.warn('Color selection failed:', error);
    }
  }
}
