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
    this.isHoverListenerSetup = false; // Track if hover listeners are already set up
    this.lastAutoPickedColor = null; // Track last auto-picked color to avoid redundant selections
    this.currentSelectedColor = null; // Track currently selected color in palette
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
          
          // NOTE: Auto color picking removed from here - it was triggering too early
          // Auto color picking now happens during paint mode hover/click events
          
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
    console.log(`🎨 [AUTO-COLOR] Starting auto color picking for coords:`, { coordsTile, coordsPixel });
    
    try {
      // Check if we have active templates
      if (!this.templateManager?.templatesArray?.length) {
        console.log(`🎨 [AUTO-COLOR] No templates active - skipping`);
        return; // No templates active, nothing to pick
      }

      const activeTemplate = this.templateManager.templatesArray[0];
      console.log(`🎨 [AUTO-COLOR] Active template:`, activeTemplate);
      
      if (!activeTemplate?.chunked) {
        console.log(`🎨 [AUTO-COLOR] No chunked template data - skipping`);
        return; // No template data available
      }

      // Convert coordinates to numbers
      const tileX = parseInt(coordsTile[0]);
      const tileY = parseInt(coordsTile[1]);  
      const pixelX = parseInt(coordsPixel[0]);
      const pixelY = parseInt(coordsPixel[1]);
      console.log(`🎨 [AUTO-COLOR] Parsed coordinates: tile(${tileX}, ${tileY}) pixel(${pixelX}, ${pixelY})`);

      // Format tile coordinates for template lookup
      const tileKey = `${tileX.toString().padStart(4, '0')},${tileY.toString().padStart(4, '0')}`;
      console.log(`🎨 [AUTO-COLOR] Looking for tile key: ${tileKey}`);
      console.log(`🎨 [AUTO-COLOR] Available template chunks:`, Object.keys(activeTemplate.chunked));
      
      // Find the template chunk that matches this pixel - try exact match first
      let templateChunkKey = Object.keys(activeTemplate.chunked).find(key => key.startsWith(tileKey));
      
      // If no exact match, try nearby tiles (coordinate estimation might be slightly off)
      if (!templateChunkKey) {
        console.log(`🎨 [AUTO-COLOR] Exact tile match failed, trying nearby tiles...`);
        
        // Try tiles within +/-1 of the estimated coordinates
        const nearbyTiles = [];
        for (let deltaX = -1; deltaX <= 1; deltaX++) {
          for (let deltaY = -1; deltaY <= 1; deltaY++) {
            if (deltaX === 0 && deltaY === 0) continue; // Already tried exact match
            
            const nearbyTileX = tileX + deltaX;
            const nearbyTileY = tileY + deltaY;
            const nearbyTileKey = `${nearbyTileX.toString().padStart(4, '0')},${nearbyTileY.toString().padStart(4, '0')}`;
            nearbyTiles.push(nearbyTileKey);
          }
        }
        
        console.log(`🎨 [AUTO-COLOR] Checking nearby tiles:`, nearbyTiles);
        
        for (const nearbyTileKey of nearbyTiles) {
          templateChunkKey = Object.keys(activeTemplate.chunked).find(key => key.startsWith(nearbyTileKey));
          if (templateChunkKey) {
            console.log(`🎨 [AUTO-COLOR] ✅ Found template in nearby tile: ${nearbyTileKey}`);
            break;
          }
        }
      }
      
      if (!templateChunkKey) {
        console.log(`🎨 [AUTO-COLOR] No template data for tile ${tileKey} or nearby tiles - skipping`);
        return; // No template data for this tile or nearby
      }
      console.log(`🎨 [AUTO-COLOR] Found matching chunk: ${templateChunkKey}`);

      // Get the template bitmap for this chunk
      const templateBitmap = activeTemplate.chunked[templateChunkKey];
      if (!templateBitmap) {
        console.log(`🎨 [AUTO-COLOR] Template bitmap is null - skipping`);
        return;
      }
      console.log(`🎨 [AUTO-COLOR] Template bitmap size: ${templateBitmap.width}x${templateBitmap.height}`);

      // Extract the pixel coordinates within the chunk
      const chunkCoords = templateChunkKey.split(',');
      const chunkPixelX = parseInt(chunkCoords[2]);
      const chunkPixelY = parseInt(chunkCoords[3]);
      console.log(`🎨 [AUTO-COLOR] Chunk coordinates: pixel(${chunkPixelX}, ${chunkPixelY})`);
      
      // Calculate the pixel position within the template bitmap
      const drawMult = this.templateManager.drawMult || 3;
      const localX = (pixelX - chunkPixelX) * drawMult + 1; // +1 to get center pixel
      const localY = (pixelY - chunkPixelY) * drawMult + 1; // +1 to get center pixel
      console.log(`🎨 [AUTO-COLOR] Local coordinates in bitmap: (${localX}, ${localY}) with drawMult=${drawMult}`);

      // Create a canvas to read the pixel data
      const tempCanvas = new OffscreenCanvas(templateBitmap.width, templateBitmap.height);
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(templateBitmap, 0, 0);
      
      // Check if the coordinates are within bounds
      if (localX < 0 || localX >= templateBitmap.width || localY < 0 || localY >= templateBitmap.height) {
        console.log(`🎨 [AUTO-COLOR] Coordinates out of bounds: (${localX}, ${localY}) vs size (${templateBitmap.width}, ${templateBitmap.height}) - skipping`);
        return;
      }

      // Get the pixel data
      const imageData = tempCtx.getImageData(localX, localY, 1, 1);
      const [r, g, b, a] = imageData.data;
      console.log(`🎨 [AUTO-COLOR] Template pixel color: rgba(${r}, ${g}, ${b}, ${a})`);

      // Skip transparent pixels
      if (a < 64) {
        console.log(`🎨 [AUTO-COLOR] Transparent pixel (alpha=${a}) - skipping`);
        return;
      }

      // Skip transparent template color (deface sentinel)
      if (r === 222 && g === 250 && b === 206) {
        console.log(`🎨 [AUTO-COLOR] Deface sentinel color - skipping`);
        return;
      }

      // Find the matching color in the palette
      const targetColor = colorpalette.find(color => 
        color.rgb[0] === r && color.rgb[1] === g && color.rgb[2] === b
      );
      console.log(`🎨 [AUTO-COLOR] Looking for color rgb(${r}, ${g}, ${b}) in palette...`);

      if (targetColor) {
        console.log(`🎨 [AUTO-COLOR] Found matching color: #${targetColor.id} (${targetColor.name})`);
        
        // Check if this color is already selected - avoid redundant selections
        const currentlySelectedColor = this.#getCurrentSelectedColor();
        console.log(`🎨 [AUTO-COLOR] Currently selected color: ${currentlySelectedColor}`);
        
        if (currentlySelectedColor === targetColor.id) {
          console.log(`🎨 [AUTO-COLOR] ✅ Color #${targetColor.id} (${targetColor.name}) is already selected - no change needed`);
          return; // Color already selected, no need to change
        }
        
        // Check if we just auto-picked this color recently to avoid rapid switching
        if (this.lastAutoPickedColor === targetColor.id) {
          console.log(`🎨 [AUTO-COLOR] ⏭️ Color #${targetColor.id} was recently auto-picked - debouncing`);
          return; // Recently selected, avoid rapid switching
        }
        
        // Auto-select the color by simulating a click on the color palette
        console.log(`🎨 [AUTO-COLOR] 🔄 Switching from color #${currentlySelectedColor} to #${targetColor.id} (${targetColor.name})`);
        this.#selectColor(targetColor.id);
        this.lastAutoPickedColor = targetColor.id;
        this.currentSelectedColor = targetColor.id;
        console.log(`🎨 [AUTO-COLOR] ✅ Auto-picked color #${targetColor.id} (${targetColor.name}) for pixel at ${tileX},${tileY}:${pixelX},${pixelY}`);
      } else {
        console.log(`🎨 [AUTO-COLOR] ❌ No matching color found for rgb(${r}, ${g}, ${b})`);
        console.log(`🎨 [AUTO-COLOR] Available palette colors:`, colorpalette.map(c => `${c.id}: rgb(${c.rgb.join(', ')})`));
      }

    } catch (error) {
      console.error('🎨 [AUTO-COLOR] Auto color picking failed:', error);
    }
  }

  /** Selects a color in the color palette UI
   * @param {number} colorId - The ID of the color to select
   * @since 1.0.0
   */
  #selectColor(colorId) {
    console.log(`🎯 [COLOR-SELECT] Attempting to select color ID: ${colorId}`);
    
    try {
      // Look for the color element by ID
      const colorElement = document.querySelector(`#color-${colorId}`);
      console.log(`🎯 [COLOR-SELECT] Color element found:`, colorElement);
      
      if (colorElement) {
        console.log(`🎯 [COLOR-SELECT] Clicking color element #color-${colorId}`);
        colorElement.click();
        
        // Verify the click worked by checking if it has the selected classes
        setTimeout(() => {
          const updatedElement = document.querySelector(`#color-${colorId}`);
          const hasRing = updatedElement?.classList.contains('ring-primary') || updatedElement?.classList.contains('ring-2');
          console.log(`🎯 [COLOR-SELECT] Selection result for #color-${colorId}: ${hasRing ? '✅ SUCCESS' : '❌ FAILED'}`);
          console.log(`🎯 [COLOR-SELECT] Element classes:`, updatedElement?.classList.toString());
          
          // Update our internal tracking
          if (hasRing) {
            this.currentSelectedColor = colorId;
            console.log(`🎯 [COLOR-SELECT] Updated internal tracking: currentSelectedColor = ${colorId}`);
          }
        }, 100);
        
        return;
      }

      console.log(`🎯 [COLOR-SELECT] Direct ID selection failed, trying fallback method`);

      // Fallback: look for elements with the color as background
      const colorData = colorpalette.find(c => c.id === colorId);
      if (!colorData) {
        console.log(`🎯 [COLOR-SELECT] Color data not found for ID ${colorId}`);
        return;
      }

      const [r, g, b] = colorData.rgb;
      const targetRgb = `rgb(${r}, ${g}, ${b})`;
      console.log(`🎯 [COLOR-SELECT] Looking for background color: ${targetRgb}`);
      
      // Find element by background color
      const allColorElements = document.querySelectorAll('[id^="color-"]');
      console.log(`🎯 [COLOR-SELECT] Found ${allColorElements.length} color elements to check`);
      
      for (const element of allColorElements) {
        const bgColor = window.getComputedStyle(element).backgroundColor;
        if (bgColor === targetRgb) {
          console.log(`🎯 [COLOR-SELECT] Found matching background color on element:`, element);
          element.click();
          
          // Verify the click worked
          setTimeout(() => {
            const hasRing = element?.classList.contains('ring-primary') || element?.classList.contains('ring-2');
            console.log(`🎯 [COLOR-SELECT] Fallback selection result: ${hasRing ? '✅ SUCCESS' : '❌ FAILED'}`);
            
            // Update our internal tracking
            if (hasRing) {
              this.currentSelectedColor = colorId;
              console.log(`🎯 [COLOR-SELECT] Updated internal tracking (fallback): currentSelectedColor = ${colorId}`);
            }
          }, 100);
          
          return;
        }
      }

      console.log(`🎯 [COLOR-SELECT] ❌ No matching element found for color ${colorId}`);
      console.log(`🎯 [COLOR-SELECT] All color elements:`, Array.from(allColorElements).map(el => ({
        id: el.id,
        bgColor: window.getComputedStyle(el).backgroundColor
      })));

    } catch (error) {
      console.error('🎯 [COLOR-SELECT] Color selection failed:', error);
    }
  }

  /** Gets the currently selected color ID from the color palette
   * @returns {number|null} The ID of the currently selected color, or null if none selected
   * @since 1.0.0
   */
  #getCurrentSelectedColor() {
    try {
      // Look for the color element with the selected classes (ring-primary and ring-2)
      const selectedElement = document.querySelector('[id^="color-"].ring-primary.ring-2');
      if (selectedElement) {
        const colorId = selectedElement.id.replace('color-', '');
        console.log(`🎯 [GET-COLOR] Found selected color element: #${colorId}`);
        return parseInt(colorId);
      }

      // Fallback: look for any element with ring classes
      const ringElement = document.querySelector('[id^="color-"][class*="ring-primary"], [id^="color-"][class*="ring-2"]');
      if (ringElement) {
        const colorId = ringElement.id.replace('color-', '');
        console.log(`🎯 [GET-COLOR] Found ring element (fallback): #${colorId}`);
        return parseInt(colorId);
      }

      console.log(`🎯 [GET-COLOR] No selected color found`);
      return null;
      
    } catch (error) {
      console.error('🎯 [GET-COLOR] Failed to get current selected color:', error);
      return null;
    }
  }

  /** Sets up hover detection for auto color picking during paint mode
   * @since 1.0.0
   */
  setupHoverDetection() {
    if (this.isHoverListenerSetup) {
      return; // Already set up
    }

    console.log(`🖱️ [HOVER] Setting up hover detection for auto color picking`);

    try {
      // Find the main canvas element
      const canvas = document.querySelector('canvas.maplibregl-canvas');
      if (!canvas) {
        console.log(`🖱️ [HOVER] Canvas not found, retrying in 1 second...`);
        setTimeout(() => this.setupHoverDetection(), 1000);
        return;
      }

      console.log(`🖱️ [HOVER] Found canvas:`, canvas);

      let isSpacePressed = false;
      let lastHoverTime = 0;
      const hoverDebounce = 100; // Debounce hover events

      // Listen for space key press/release
      document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !event.repeat) {
          isSpacePressed = true;
          console.log(`⌨️ [HOVER] Space key pressed - enabling auto color picking`);
        }
      });

      document.addEventListener('keyup', (event) => {
        if (event.code === 'Space') {
          isSpacePressed = false;
          console.log(`⌨️ [HOVER] Space key released - disabling auto color picking`);
        }
      });

      // Listen for mouse move on canvas
      canvas.addEventListener('mousemove', async (event) => {
        const now = Date.now();
        if (now - lastHoverTime < hoverDebounce) {
          return; // Debounce
        }
        lastHoverTime = now;

        // Only auto pick colors when space is pressed or in paint mode
        if (!isSpacePressed && !this.#isPaintMode()) {
          return;
        }

        console.log(`🖱️ [HOVER] Mouse move detected in paint mode or with space key`);
        
        // Get coordinates from mouse position
        const coords = this.#getCanvasCoordinatesFromMouseEvent(event);
        if (coords) {
          const { tileX, tileY, pixelX, pixelY } = coords;
          await this.#performAutoColorPicking([tileX.toString(), tileY.toString()], [pixelX.toString(), pixelY.toString()]);
        }
      });

      // Listen for canvas clicks in paint mode
      canvas.addEventListener('click', async (event) => {
        if (!this.#isPaintMode()) {
          return; // Not in paint mode
        }

        console.log(`🖱️ [HOVER] Canvas click detected in paint mode`);
        
        const coords = this.#getCanvasCoordinatesFromMouseEvent(event);
        if (coords) {
          const { tileX, tileY, pixelX, pixelY } = coords;
          await this.#performAutoColorPicking([tileX.toString(), tileY.toString()], [pixelX.toString(), pixelY.toString()]);
        }
      });

      this.isHoverListenerSetup = true;
      console.log(`🖱️ [HOVER] Hover detection setup complete`);

    } catch (error) {
      console.error('🖱️ [HOVER] Failed to setup hover detection:', error);
    }
  }

  /** Checks if the user is currently in paint mode
   * @returns {boolean} True if in paint mode
   * @since 1.0.0
   */
  #isPaintMode() {
    // Look for indicators that paint mode is active
    // This might need adjustment based on how the site indicates paint mode
    
    // Check if color palette is enabled (not disabled/grayed out)
    const colorElements = document.querySelectorAll('[id^="color-"]');
    const hasEnabledColors = Array.from(colorElements).some(el => !el.disabled && !el.classList.contains('opacity-50'));
    
    // Check if there's a selected color (has ring classes)
    const hasSelectedColor = Array.from(colorElements).some(el => 
      el.classList.contains('ring-primary') || el.classList.contains('ring-2')
    );

    const isPaintMode = hasEnabledColors && hasSelectedColor;
    console.log(`🎨 [PAINT-MODE] Paint mode check: enabled=${hasEnabledColors}, selected=${hasSelectedColor}, result=${isPaintMode}`);
    
    return isPaintMode;
  }

  /** Gets tile and pixel coordinates from a mouse event on the canvas
   * @param {MouseEvent} event - The mouse event
   * @returns {Object|null} Coordinates object or null if invalid
   * @since 1.0.0
   */
  #getCanvasCoordinatesFromMouseEvent(event) {
    try {
      const canvas = event.target;
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      console.log(`🖱️ [HOVER] Mouse position: (${mouseX}, ${mouseY}) on canvas`);
      
      // Try to access the map instance to get the coordinate conversion
      // MapLibre GL JS maps are usually accessible via a global variable or canvas property
      let map = null;
      
      // Common ways to access the map instance:
      if (window.map) {
        map = window.map;
      } else if (canvas._map) {
        map = canvas._map;
      } else if (canvas.map) {
        map = canvas.map;
      } else {
        // Try to find map instance in common global variables
        const possibleMapKeys = ['maplibregl', 'mapboxgl', 'leaflet', 'map', 'mapInstance'];
        for (const key of possibleMapKeys) {
          if (window[key] && typeof window[key].unproject === 'function') {
            map = window[key];
            break;
          }
        }
      }
      
      if (!map || typeof map.unproject !== 'function') {
        console.log(`🖱️ [HOVER] ❌ Map instance not found or unproject method unavailable`);
        console.log(`🖱️ [HOVER] Available window properties:`, Object.keys(window).filter(k => k.includes('map')));
        
        // Fallback: Try to estimate coordinates based on known zoom/center if available
        return this.#estimateCoordinatesFromMousePosition(mouseX, mouseY, canvas);
      }
      
      console.log(`🖱️ [HOVER] ✅ Found map instance:`, map);
      
      // Convert mouse position to map coordinates using MapLibre/Mapbox unproject
      const lngLat = map.unproject([mouseX, mouseY]);
      console.log(`🖱️ [HOVER] Map coordinates: lng=${lngLat.lng}, lat=${lngLat.lat}`);
      
      // Convert lng/lat to tile/pixel coordinates
      // This depends on the site's coordinate system - typically uses a custom projection
      const coords = this.#convertMapCoordsToTilePixel(lngLat.lng, lngLat.lat, map);
      
      if (coords) {
        console.log(`🖱️ [HOVER] ✅ Converted to tile/pixel: ${coords.tileX},${coords.tileY}:${coords.pixelX},${coords.pixelY}`);
        return coords;
      }
      
      return null;
      
    } catch (error) {
      console.error('🖱️ [HOVER] Failed to get coordinates from mouse event:', error);
      return null;
    }
  }

  /** Estimates coordinates from mouse position when map instance is not available
   * @param {number} mouseX - Mouse X position on canvas
   * @param {number} mouseY - Mouse Y position on canvas  
   * @param {HTMLCanvasElement} canvas - The canvas element
   * @returns {Object|null} Estimated coordinates or null
   * @since 1.0.0
   */
  #estimateCoordinatesFromMousePosition(mouseX, mouseY, canvas) {
    console.log(`🖱️ [HOVER] Attempting coordinate estimation fallback`);
    
    // Try to find template coordinates from active template to help calibrate
    const activeTemplate = this.templateManager?.templatesArray?.[0];
    if (activeTemplate?.chunked) {
      const templateChunks = Object.keys(activeTemplate.chunked);
      console.log(`🖱️ [HOVER] Template chunks available:`, templateChunks);
      
      if (templateChunks.length > 0) {
        // Parse the template chunk coordinates to understand the coordinate system
        const firstChunk = templateChunks[0]; // e.g., "1068,0698,319,546"
        const coords = firstChunk.split(',').map(Number);
        const [templateTileX, templateTileY, templatePixelX, templatePixelY] = coords;
        
        console.log(`🖱️ [HOVER] Template is at tile(${templateTileX}, ${templateTileY}) pixel(${templatePixelX}, ${templatePixelY})`);
        
        // For testing, let's try to map mouse position to template coordinates
        // This is still rough but should be closer to the actual template location
        
        // Get canvas center 
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Calculate offset from center
        const offsetX = mouseX - centerX;
        const offsetY = mouseY - centerY;
        
        console.log(`🖱️ [HOVER] Mouse offset from canvas center: (${offsetX}, ${offsetY})`);
        
        // Estimate coordinates relative to template location
        // This is still a guess but should be more accurate than before
        const estimatedTileX = templateTileX + Math.floor(offsetX / 100); // Rough scaling
        const estimatedTileY = templateTileY + Math.floor(offsetY / 100); // Rough scaling
        const estimatedPixelX = templatePixelX + (offsetX % 100); // Pixel offset
        const estimatedPixelY = templatePixelY + (offsetY % 100); // Pixel offset
        
        // Ensure coordinates are positive and within reasonable bounds
        const finalTileX = Math.max(0, Math.min(9999, estimatedTileX));
        const finalTileY = Math.max(0, Math.min(9999, estimatedTileY));
        const finalPixelX = Math.max(0, Math.min(999, Math.abs(estimatedPixelX)));
        const finalPixelY = Math.max(0, Math.min(999, Math.abs(estimatedPixelY)));
        
        console.log(`🖱️ [HOVER] ⚠️ Template-relative coordinates (EXPERIMENTAL): ${finalTileX},${finalTileY}:${finalPixelX},${finalPixelY}`);
        
        return {
          tileX: finalTileX,
          tileY: finalTileY,
          pixelX: finalPixelX,
          pixelY: finalPixelY
        };
      }
    }
    
    // Fallback to simple estimation if no template data
    const estimatedTileX = Math.floor(mouseX / 10) % 1000;
    const estimatedTileY = Math.floor(mouseY / 10) % 1000;
    const estimatedPixelX = mouseX % 1000;
    const estimatedPixelY = mouseY % 1000;
    
    console.log(`🖱️ [HOVER] ⚠️ Using basic estimated coordinates (INACCURATE): ${estimatedTileX},${estimatedTileY}:${estimatedPixelX},${estimatedPixelY}`);
    
    return {
      tileX: estimatedTileX,
      tileY: estimatedTileY,
      pixelX: estimatedPixelX,
      pixelY: estimatedPixelY
    };
  }

  /** Converts map lng/lat coordinates to tile/pixel coordinates
   * @param {number} lng - Longitude
   * @param {number} lat - Latitude
   * @param {Object} map - Map instance
   * @returns {Object|null} Tile/pixel coordinates or null
   * @since 1.0.0
   */
  #convertMapCoordsToTilePixel(lng, lat, map) {
    try {
      // This conversion depends on the site's specific coordinate system
      // Most pixel art sites use a custom projection where each pixel maps to specific coordinates
      
      // Get current zoom level for scaling
      const zoom = map.getZoom();
      console.log(`🖱️ [HOVER] Current zoom level: ${zoom}`);
      
      // Site-specific coordinate conversion logic would go here
      // For now, provide a basic implementation that may need adjustment
      
      // Assuming the site uses a simple coordinate system where:
      // - Each tile is 1000x1000 pixels
      // - Coordinates map directly to pixel positions
      
      // This is a placeholder - needs site-specific implementation
      const worldX = lng * 1000000; // Scale factor needs adjustment
      const worldY = lat * 1000000; // Scale factor needs adjustment
      
      const tileX = Math.floor(worldX / 1000);
      const tileY = Math.floor(worldY / 1000);  
      const pixelX = Math.floor(worldX % 1000);
      const pixelY = Math.floor(worldY % 1000);
      
      console.log(`🖱️ [HOVER] ⚠️ Using basic coordinate conversion (may be inaccurate)`);
      console.log(`🖱️ [HOVER] World coords: (${worldX}, ${worldY})`);
      
      return {
        tileX: Math.abs(tileX),
        tileY: Math.abs(tileY),
        pixelX: Math.abs(pixelX),
        pixelY: Math.abs(pixelY)
      };
      
    } catch (error) {
      console.error('🖱️ [HOVER] Failed to convert map coordinates:', error);
      return null;
    }
  }
}
