/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn, selectAllCoordinateInputs } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.textContent = `(${callback})();`;
    document.documentElement?.appendChild(script);
    script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

const storageTemplates = JSON.parse(GM_getValue('bmTemplates', '{}'));
console.log(storageTemplates);
templateManager.importJSON(storageTemplates); // Loads the templates

const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}')); // Loads the user settings (kept for future settings)

buildOverlayMain(); // Builds the main overlay

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
async function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)
  // Load last saved coordinates (if any)
  let savedCoords = {};
  try { savedCoords = JSON.parse(GM_getValue('bmCoords', '{}')) || {}; } catch (_) { savedCoords = {}; }
  const persistCoords = () => {
    try {
      const tx = Number(document.querySelector('#bm-input-tx')?.value || '');
      const ty = Number(document.querySelector('#bm-input-ty')?.value || '');
      const px = Number(document.querySelector('#bm-input-px')?.value || '');
      const py = Number(document.querySelector('#bm-input-py')?.value || '');
      const data = { tx, ty, px, py };
      GM.setValue('bmCoords', JSON.stringify(data));
    } catch (_) {}
  };
  
  // Inline critical positioning so the overlay remains visible even if CSS fails to load
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'position: fixed; z-index: 2147483647; top: 10px; right: 75px;'})
      .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addImg({'id': 'bm-button-logo', 'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;'}, 
        (instance, img) => {
          /** Click event handler for overlay minimize/maximize functionality.
           * 
           * Toggles between two distinct UI states:
           * 1. MINIMIZED STATE (60×76px):
           *    - Shows only the Blue Marble icon and drag bar
           *    - Hides all input fields, buttons, and status information
           *    - Applies fixed dimensions for consistent appearance
           *    - Repositions icon with 3px right offset for visual centering
           * 
           * 2. MAXIMIZED STATE (responsive):
           *    - Restores full functionality with all UI elements
           *    - Removes fixed dimensions to allow responsive behavior
           *    - Resets icon positioning to default alignment
           *    - Shows success message when returning to maximized state
           * 
           * @param {Event} event - The click event object (implicit)
           */
          // Minimized drag support state
          let miniIsDragging = false;
          let miniStartX = 0, miniStartY = 0;
          let miniOffsetX = 0, miniOffsetY = 0;
          let miniMoveHandler = null, miniUpHandler = null, miniDownHandler = null;

          const attachMiniDrag = (overlayEl) => {
            if (!overlayEl) return;
            const getPoint = (evt) => (evt.touches?.[0]) || evt;
            const onDown = (evt) => {
              if (!isMinimized) return;
              const p = getPoint(evt);
              miniIsDragging = true;
              const rect = overlayEl.getBoundingClientRect();
              miniOffsetX = p.clientX - rect.left;
              miniOffsetY = p.clientY - rect.top;
              miniStartX = rect.left;
              miniStartY = rect.top;
              document.addEventListener('mousemove', onMove, { passive: true });
              document.addEventListener('mouseup', onUp, { passive: true });
              document.addEventListener('touchmove', onMove, { passive: false });
              document.addEventListener('touchend', onUp, { passive: true });
              overlayEl.style.transition = 'none';
            };
            const onMove = (evt) => {
              if (!miniIsDragging) return;
              const p = getPoint(evt);
              const nx = p.clientX - miniOffsetX;
              const ny = p.clientY - miniOffsetY;
              overlayEl.style.transform = `translate(${nx}px, ${ny}px)`;
              overlayEl.style.left = '0px';
              overlayEl.style.top = '0px';
              evt.preventDefault?.();
            };
            const onUp = (evt) => {
              if (!miniIsDragging) return;
              miniIsDragging = false;
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              document.removeEventListener('touchmove', onMove);
              document.removeEventListener('touchend', onUp);
              // mark that a drag just occurred to prevent immediate toggle
              try {
                const rect = overlayEl.getBoundingClientRect();
                const dx = Math.abs(rect.left - miniStartX);
                const dy = Math.abs(rect.top - miniStartY);
                if (dx > 3 || dy > 3) {
                  overlayEl.dataset.justDragged = '1';
                  setTimeout(() => { overlayEl && (overlayEl.dataset.justDragged = ''); }, 200);
                }
              } catch (_) {}
              // restore transition
              overlayEl.style.transition = '';
            };
            miniDownHandler = onDown;
            miniMoveHandler = onMove;
            miniUpHandler = onUp;
            overlayEl.addEventListener('mousedown', onDown);
            overlayEl.addEventListener('touchstart', onDown, { passive: false });
          };
          const detachMiniDrag = (overlayEl) => {
            if (!overlayEl) return;
            if (miniDownHandler) overlayEl.removeEventListener('mousedown', miniDownHandler);
            if (miniDownHandler) overlayEl.removeEventListener('touchstart', miniDownHandler);
            document.removeEventListener('mousemove', miniMoveHandler || (()=>{}));
            document.removeEventListener('mouseup', miniUpHandler || (()=>{}));
            document.removeEventListener('touchmove', miniMoveHandler || (()=>{}));
            document.removeEventListener('touchend', miniUpHandler || (()=>{}));
          };

          img.addEventListener('click', () => {
            const overlayEl = document.querySelector('#bm-overlay');
            if (overlayEl?.dataset?.justDragged === '1') { overlayEl.dataset.justDragged = ''; return; }
            isMinimized = !isMinimized; // Toggle the current state

            const overlay = document.querySelector('#bm-overlay');
            const header = document.querySelector('#bm-contain-header');
            const dragBar = document.querySelector('#bm-bar-drag');
            const coordsContainer = document.querySelector('#bm-contain-coords');
            const coordsButton = document.querySelector('#bm-button-coords');
            const createButton = document.querySelector('#bm-button-create');
            const enableButton = document.querySelector('#bm-button-enable');
            const disableButton = document.querySelector('#bm-button-disable');
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            
            // Pre-restore original dimensions when switching to maximized state
            // This ensures smooth transition and prevents layout issues
            if (!isMinimized) {
              overlay.style.width = "auto";
              overlay.style.maxWidth = "300px";
              overlay.style.minWidth = "200px";
              overlay.style.padding = "10px";
            }
            
            // Define elements that should be hidden/shown during state transitions
            // Each element is documented with its purpose for maintainability
            const elementsToToggle = [
              '#bm-overlay h1',                    // Main title "Blue Marble"
              '#bm-contain-userinfo',              // User information section (username, droplets, level)
              '#bm-overlay hr',                    // Visual separator lines
              '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
              '#bm-input-file-template',           // Template file upload interface
              '#bm-contain-buttons-action',        // Action buttons container
              `#${instance.outputStatusId}`,       // Status log textarea for user feedback
              '#bm-contain-colorfilter',           // Color filter UI
              '#bm-button-minimize'                // Minimize button
            ];
            
            // Apply visibility changes to all toggleable elements
            elementsToToggle.forEach(selector => {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                element.style.display = isMinimized ? 'none' : '';
              });
            });
            // Handle coordinate container and button visibility based on state
            if (isMinimized) {
              // ==================== MINIMIZED STATE CONFIGURATION ====================
              // In minimized state, we hide ALL interactive elements except the icon and drag bar
              // This creates a clean, unobtrusive interface that maintains only essential functionality
              
              // Hide coordinate input container completely
              if (coordsContainer) {
                coordsContainer.style.display = 'none';
              }
              
              // Hide coordinate button (pin icon)
              if (coordsButton) {
                coordsButton.style.display = 'none';
              }
              
              // Hide create template button
              if (createButton) {
                createButton.style.display = 'none';
              }

              // Hide enable templates button
              if (enableButton) {
                enableButton.style.display = 'none';
              }

              // Hide disable templates button
              if (disableButton) {
                disableButton.style.display = 'none';
              }
              
              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              overlay.style.width = '60px';    // Fixed width for consistency
              overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
              overlay.style.maxWidth = '60px';  // Prevent expansion
              overlay.style.minWidth = '60px';  // Prevent shrinking
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
              // Apply icon positioning for better visual centering in minimized state
              // The 3px offset compensates for visual weight distribution
              img.style.marginLeft = '3px';
              
              // Configure header layout for minimized state
              header.style.textAlign = 'center';
              header.style.margin = '0';
              header.style.marginBottom = '0';
              
              // Hide drag bar in minimized state for a clean round icon, enable drag on the circle itself
              if (dragBar) {
                dragBar.style.display = 'none';
                dragBar.style.marginBottom = '0';
              }

              // Small round icon appearance
              overlay.style.width = '56px';
              overlay.style.height = '56px';
              overlay.style.maxWidth = '56px';
              overlay.style.minWidth = '56px';
              overlay.style.padding = '6px';
              overlay.style.borderRadius = '50%';
              img.style.height = '42px';
              // attach minimized drag handlers
              attachMiniDrag(overlay);
            } else {
              // ==================== MAXIMIZED STATE RESTORATION ====================
              // In maximized state, we restore all elements to their default functionality
              // This involves clearing all style overrides applied during minimization
              
              // Restore coordinate container to default state
              if (coordsContainer) {
                coordsContainer.style.display = '';           // Show container
                coordsContainer.style.flexDirection = '';     // Reset flex layout
                coordsContainer.style.justifyContent = '';    // Reset alignment
                coordsContainer.style.alignItems = '';        // Reset alignment
                coordsContainer.style.gap = '';               // Reset spacing
                coordsContainer.style.textAlign = '';         // Reset text alignment
                coordsContainer.style.margin = '';            // Reset margins
              }
              
              // Restore coordinate button visibility
              if (coordsButton) {
                coordsButton.style.display = '';
              }
              
              // Restore create button visibility and reset positioning
              if (createButton) {
                createButton.style.display = '';
                createButton.style.marginTop = '';
              }

              // Restore enable button visibility and reset positioning
              if (enableButton) {
                enableButton.style.display = '';
                enableButton.style.marginTop = '';
              }

              // Restore disable button visibility and reset positioning
              if (disableButton) {
                disableButton.style.display = '';
                disableButton.style.marginTop = '';
              }
              
              // Restore all coordinate input fields
              coordInputs.forEach(input => {
                input.style.display = '';
              });
              
              // Reset icon positioning to default (remove minimized state offset)
              img.style.marginLeft = '';
              
              // Restore overlay to responsive dimensions
              overlay.style.padding = '10px';
              
              // Reset header styling to defaults
              header.style.textAlign = '';
              header.style.margin = '';
              header.style.marginBottom = '';
              
              // Reset drag bar spacing
              if (dragBar) {
                dragBar.style.display = '';
                dragBar.style.marginBottom = '0.5em';
              }
              
              // Remove all fixed dimensions to allow responsive behavior
              // This ensures the overlay can adapt to content changes
              overlay.style.width = '';
              overlay.style.height = '';
              overlay.style.maxWidth = '';
              overlay.style.minWidth = '';
              overlay.style.borderRadius = '';
              img.style.height = '';
              // detach minimized drag handlers
              detachMiniDrag(overlay);
            }
            
            // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
            // Update accessibility information for screen readers and tooltips
            
            // Update alt text to reflect current state for screen readers and tooltips
            img.alt = isMinimized ? 
              'Blue Marble Icon - Minimized (Click to maximize)' : 
              'Blue Marble Icon - Maximized (Click to minimize)';
            
            // No status message needed - state change is visually obvious to users
          });
        }
      ).buildElement()
      .addHeader(1, {'textContent': name}).buildElement()
      // Small minimize button to the right of title
      .addButton({'id': 'bm-button-minimize', 'className': 'bm-help', 'title': 'Minimize overlay', 'style': 'margin-left: auto;',
                  'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="2" fill="white" rx="1"/></svg>'},
        (instance, button) => {
          button.addEventListener('click', () => {
            try { document.getElementById('bm-button-logo')?.click(); } catch (_) {}
          });
        }
      ).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addP({'id': 'bm-user-name', 'textContent': 'Username:'}).buildElement()
      .addP({'id': 'bm-user-droplets', 'textContent': 'Droplets:'}).buildElement()
      .addP({'id': 'bm-user-nextlevel', 'textContent': 'Next level in...'}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>'},
          (instance, button) => {
            button.onclick = () => {
              const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
              if (!coords?.[0]) {
                instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                return;
              }
              instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
              instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
              instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
              instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
              persistCoords();
            }
          }
        ).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.tx ?? '')}, (instance, input) => {
          //if a paste happens on tx, split and format it into other coordinates if possible
          input.addEventListener("paste", (event) => {
            let splitText = (event.clipboardData || window.clipboardData).getData("text").split(" ").filter(n => n).map(Number).filter(n => !isNaN(n)); //split and filter all Non Numbers

            if (splitText.length !== 4 ) { // If we don't have 4 clean coordinates, end the function.
              return;
            }

            let coords = selectAllCoordinateInputs(document); 

            for (let i = 0; i < coords.length; i++) { 
              coords[i].value = splitText[i]; //add the split vales
            }

            event.preventDefault(); //prevent the pasting of the original paste that would overide the split value
          })
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.ty ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.px ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.py ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        // Paste coordinates from clipboard (small paper icon) — placed to the right of the four inputs
        .addButton({'id': 'bm-button-paste-coords', 'className': 'bm-help', 'title': 'Paste coordinates from clipboard', 'style': 'margin-left: 0.5ch;',
                    'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="white" d="M6 2h8a2 2 0 0 1 2 2v2h-2V4H6v2H4V4a2 2 0 0 1 2-2zm-2 6h12v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zm3 3v2h6v-2H7z"/></svg>'},
          (instance, button) => {
            button.onclick = async () => {
              try {
                let text = '';
                try { text = await navigator.clipboard.readText(); } catch (_) {}
                if (!text) { instance.handleDisplayError('No clipboard text found.'); return; }

                // Try labeled format first: Tl X: <n>, Tl Y: <n>, Px X: <n>, Px Y: <n>
                const labeled = /Tl\s*X:\s*(-?\d+)[^\d-]+Tl\s*Y:\s*(-?\d+)[^\d-]+Px\s*X:\s*(-?\d+)[^\d-]+Px\s*Y:\s*(-?\d+)/i.exec(text);

                let nums = null;
                if (labeled) {
                  nums = [labeled[1], labeled[2], labeled[3], labeled[4]].map(n => Number(n));
                } else {
                  // Fallback: find 4 integers in sequence
                  const found = (text.match(/-?\d+/g) || []).map(n => Number(n)).filter(n => Number.isFinite(n));
                  if (found.length >= 4) {
                    nums = found.slice(0,4);
                  }
                }

                if (!nums) { instance.handleDisplayError('Clipboard text missing 4 coordinates.'); return; }

                const [tx, ty, px, py] = nums;
                instance.updateInnerHTML('bm-input-tx', String(tx));
                instance.updateInnerHTML('bm-input-ty', String(ty));
                instance.updateInnerHTML('bm-input-px', String(px));
                instance.updateInnerHTML('bm-input-py', String(py));
                try { (typeof persistCoords === 'function') && persistCoords(); } catch (_) {}
                instance.handleDisplayStatus('Pasted coordinates from clipboard');
              } catch (e) {
                instance.handleDisplayError(`Failed to paste coordinates: ${e?.message || e}`);
              }
            };
          }
        ).buildElement()
      .buildElement()
      // Color filter UI
      .addDiv({'id': 'bm-contain-colorfilter', 'style': 'max-height: 140px; overflow: auto; border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 4px; display: none;'})
        .addDiv({'style': 'display: flex; gap: 6px; margin-bottom: 6px;'})
          .addButton({'id': 'bm-button-colors-enable-all', 'textContent': 'Enable All'}, (instance, button) => {
            button.onclick = () => {
              const t = templateManager.templatesArray[0];
              if (!t?.colorPalette) { return; }
              Object.values(t.colorPalette).forEach(v => v.enabled = true);
              buildColorFilterList();
              instance.handleDisplayStatus('Enabled all colors');
            };
          }).buildElement()
          .addButton({'id': 'bm-button-colors-disable-all', 'textContent': 'Disable All'}, (instance, button) => {
            button.onclick = () => {
              const t = templateManager.templatesArray[0];
              if (!t?.colorPalette) { return; }
              Object.values(t.colorPalette).forEach(v => v.enabled = false);
              buildColorFilterList();
              instance.handleDisplayStatus('Disabled all colors');
            };
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-colorfilter-list'}).buildElement()
      .buildElement()
      .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'},
        (instance, container, input, uploadButton) => {
          try {
            // Add a small clipboard icon button next to the upload button
            const pasteBtn = document.createElement('button');
            pasteBtn.id = 'bm-button-paste-image';
            pasteBtn.className = 'bm-help';
            pasteBtn.title = 'Paste image template from clipboard';
            pasteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="white" d="M6 2h8a2 2 0 0 1 2 2v2h-2V4H6v2H4V4a2 2 0 0 1 2-2zm-2 6h12v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zm3 3v2h6v-2H7z"/></svg>';

            // Ensure the container behaves as a row with spacing (CSS also sets this)
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '0.5ch';
            // Let the upload button flex to fill remaining space
            uploadButton.style.flex = '1 1 auto';
            uploadButton.style.minWidth = '0';

            pasteBtn.addEventListener('click', async () => {
              try {
                // 1) Read coordinates from inputs (require valid coords)
                const ix = document.querySelector('#bm-input-tx');
                const iy = document.querySelector('#bm-input-ty');
                const ipx = document.querySelector('#bm-input-px');
                const ipy = document.querySelector('#bm-input-py');
                if (!ix?.value || !iy?.value || !ipx?.value || !ipy?.value) {
                  instance.handleDisplayError('Fill coordinates first (use the pin or clipboard icon).');
                  return;
                }
                const tx = Number(ix.value); const ty = Number(iy.value); const px = Number(ipx.value); const py = Number(ipy.value);

                // 2) Read image from clipboard
                let blob = null; let fileName = 'Clipboard';
                try {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    for (const type of item.types) {
                      if (type.startsWith('image/')) {
                        blob = await item.getType(type);
                        try {
                          const ext = type.split('/')[1] || 'png';
                          fileName = `Clipboard.${ext}`;
                        } catch (_) {}
                        break;
                      }
                    }
                    if (blob) break;
                  }
                } catch (_) {}

                if (!blob) {
                  instance.handleDisplayError('No image found in clipboard. Copy an image and try again.');
                  return;
                }

                // 3) Create the template
                templateManager.createTemplate(blob, fileName.replace(/\.[^/.]+$/, ''), [tx, ty, px, py]);
                instance.handleDisplayStatus('Pasted template from clipboard!');
              } catch (e) {
                instance.handleDisplayError(`Failed to paste image template: ${e?.message || e}`);
              }
            });

            container.appendChild(pasteBtn);
          } catch (_) {}
        }
      ).buildElement()
      .addDiv({'id': 'bm-contain-buttons-template'})
        .addButton({'id': 'bm-button-enable', 'textContent': 'Enable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
            instance.handleDisplayStatus(`Enabled templates!`);
          }
        }).buildElement()
        .addButton({'id': 'bm-button-create', 'textContent': 'Create'}, (instance, button) => {
          button.onclick = () => {
            const input = document.querySelector('#bm-input-file-template');

            const coordTlX = document.querySelector('#bm-input-tx');
            if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordTlY = document.querySelector('#bm-input-ty');
            if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxX = document.querySelector('#bm-input-px');
            if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxY = document.querySelector('#bm-input-py');
            if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}

            // Kills itself if there is no file
            if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}

            templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);

            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // apiManager.templateCoordsTilePixel = apiManager.coordsTilePixel; // Update template coords
            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // templateManager.setTemplateImage(input.files[0]);

            instance.handleDisplayStatus(`Drew to canvas!`);
          }
        }).buildElement()
        // Move Disable button next to Create
        .addButton({'id': 'bm-button-disable', 'textContent': 'Disable'}, (instance, button) => {
          button.onclick = () => {
            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
            instance.handleDisplayStatus(`Disabled templates!`);
          }
        }).buildElement()
      .buildElement()
      .addTextarea({'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true}).buildElement()
  .addDiv({'id': 'bm-contain-buttons-action'})
    .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
          .addButton({'id': 'bm-button-gallery', 'className': 'bm-help', 'innerHTML': '🖼️', 'title': 'Open Gallery (pxl-wplace)'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              try {
                const GALLERY_URL = 'https://pxl-wplace.snupai.dev/gallery?from=bm';
                // Intentionally keep the opener relationship for handshake
                const win = window.open(GALLERY_URL, 'bm-gallery');
                setTimeout(() => {
                  try {
                    win && win.postMessage({ source: 'blue-marble', type: 'ready' }, 'https://pxl-wplace.snupai.dev');
                    instance.handleDisplayStatus('Opened gallery; waiting for connection...');
                  } catch (_) {}
                }, 500);
              } catch (e) {
                instance.handleDisplayError('Failed to open gallery window');
              }
            });
          }).buildElement()
          .addButton({'id': 'bm-button-website', 'className': 'bm-help', 'innerHTML': '🌐', 'title': 'Official Blue Marble Website'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://bluemarble.camilledaguin.fr/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .buildElement()
        .addSmall({'textContent': 'Made by Snupai 🏳️‍🌈', 'style': 'margin-top: auto;'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);

  // ------- External integration: accept messages from other sites -------
  // Queue messages until overlay/templateManager is ready
  window.BM_EXTERNAL_QUEUE = window.BM_EXTERNAL_QUEUE || [];
  const processExternal = async (payload) => {
    const data = payload;
    // Handle coordinate injection (supports multiple field names)
    if (data.type === 'coords' || (data.coords && data.type !== 'template')) {
      const c = data.coords || {};
      // Accept aliases: tx/tileX/TlX/position_x, ty/tileY/TlY/position_y, px/PxX, py/PxY
      const tx = Number(c.tx ?? c.tileX ?? c.TlX ?? c.position_x ?? c.tile ?? c.x);
      const ty = Number(c.ty ?? c.tileY ?? c.TlY ?? c.position_y ?? c.row ?? c.y);
      const px = Number((c.px ?? c.PxX ?? c.pixelX ?? c.offset_x ?? 0));
      const py = Number((c.py ?? c.PxY ?? c.pixelY ?? c.offset_y ?? 0));
      if ([tx, ty].every(Number.isFinite)) {
        overlayMain.updateInnerHTML('bm-input-tx', String(tx));
        overlayMain.updateInnerHTML('bm-input-ty', String(ty));
        overlayMain.updateInnerHTML('bm-input-px', Number.isFinite(px) ? String(px) : '0');
        overlayMain.updateInnerHTML('bm-input-py', Number.isFinite(py) ? String(py) : '0');
        try { GM.setValue('bmCoords', JSON.stringify({tx,ty,px: Number.isFinite(px)?px:0, py: Number.isFinite(py)?py:0})); } catch (_) {}
        overlayMain.handleDisplayStatus('Received coordinates from external site');
      } else {
        overlayMain.handleDisplayError('External coords malformed');
      }
    }

    // Handle template (image + coords)
    if (data.type === 'template') {
      const c = data.coords || {};
      const tx = Number(c.tx ?? c.tileX ?? c.TlX ?? c.position_x ?? c.tile ?? c.x);
      const ty = Number(c.ty ?? c.tileY ?? c.TlY ?? c.position_y ?? c.row ?? c.y);
      const px = Number((c.px ?? c.PxX ?? c.pixelX ?? c.offset_x ?? 0));
      const py = Number((c.py ?? c.PxY ?? c.pixelY ?? c.offset_y ?? 0));
      if (![tx, ty].every(Number.isFinite)) {
        overlayMain.handleDisplayError('External template missing valid coordinates');
        return;
      }

      let blob = null, name = data.name || 'ExternalTemplate';
      if (data.blob instanceof Blob) {
        blob = data.blob;
      } else if (data.dataUrl && typeof data.dataUrl === 'string') {
        try { blob = await (await fetch(data.dataUrl)).blob(); } catch (e) {}
      } else if (data.url && typeof data.url === 'string') {
        try { blob = await (await fetch(data.url, { mode: 'cors' })).blob(); } catch (e) {}
      }

      if (!blob) {
        overlayMain.handleDisplayError('External template image unavailable (CORS/format)');
        return;
      }
      templateManager.createTemplate(blob, name, [tx, ty, Number.isFinite(px)?px:0, Number.isFinite(py)?py:0]);
      overlayMain.handleDisplayStatus('Received template from external site');
    }
  };

  window.addEventListener('message', async (event) => {
    try {
      const data = event?.data || {};
      if (!data || data.source !== 'blue-marble-external') return;
      // If overlay/templateManager not ready yet, queue it
      if (!overlayMain || !templateManager) {
        window.BM_EXTERNAL_QUEUE.push(data);
        return;
      }
      await processExternal(data);
    } catch (e) {
      try { console.warn('Blue Marble: external message error', e); } catch (_) {}
    }
  });

  // Drain any queued messages now that we are ready
  try {
    const q = Array.isArray(window.BM_EXTERNAL_QUEUE) ? window.BM_EXTERNAL_QUEUE.splice(0) : [];
    for (const item of q) { await processExternal(item); }
  } catch (_) {}

  // Convenience: allow manual injection via DevTools
  window.BM_receiveExternal = (payload) => window.postMessage(Object.assign({ source: 'blue-marble-external' }, payload), '*');

  // Notify opener (e.g., your gallery) that Blue Marble is ready to receive
  try { window.opener && window.opener.postMessage({ source: 'blue-marble', type: 'ready' }, '*'); } catch (_) {}

  // ------- Helper: Build the color filter list -------
  window.buildColorFilterList = function buildColorFilterList() {
    const listContainer = document.querySelector('#bm-colorfilter-list');
    const t = templateManager.templatesArray?.[0];
    if (!listContainer || !t?.colorPalette) {
      if (listContainer) { listContainer.innerHTML = '<small>No template colors to display.</small>'; }
      return;
    }

    listContainer.innerHTML = '';
    const entries = Object.entries(t.colorPalette)
      .sort((a,b) => b[1].count - a[1].count); // sort by frequency desc

    for (const [rgb, meta] of entries) {
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.margin = '4px 0';

      let swatch = document.createElement('div');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.border = '1px solid rgba(255,255,255,0.5)';

      let label = document.createElement('span');
      label.style.fontSize = '12px';
      let labelText = `${meta.count.toLocaleString()}`;

      // Special handling for "other" and "transparent"
      if (rgb === 'other') {
        swatch.style.background = '#888'; // Neutral color for "Other"
        labelText = `Other • ${labelText}`;
      } else if (rgb === '#deface') {
        swatch.style.background = '#deface';
        labelText = `Transparent • ${labelText}`;
      } else {
        const [r, g, b] = rgb.split(',').map(Number);
        swatch.style.background = `rgb(${r},${g},${b})`;
        try {
          const tMeta = templateManager.templatesArray?.[0]?.rgbToMeta?.get(rgb);
          if (tMeta && typeof tMeta.id === 'number') {
            const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
            const starLeft = tMeta.premium ? '★ ' : '';
            labelText = `#${tMeta.id} ${starLeft}${displayName} • ${labelText}`;
          }
        } catch (ignored) {}
      }
      label.textContent = labelText;

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !!meta.enabled;
      toggle.addEventListener('change', () => {
        meta.enabled = toggle.checked;
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
        try {
          const t = templateManager.templatesArray?.[0];
          const key = t?.storageKey;
          if (t && key && templateManager.templatesJSON?.templates?.[key]) {
            templateManager.templatesJSON.templates[key].palette = t.colorPalette;
            // persist immediately
            GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
          }
        } catch (_) {}
      });

      row.appendChild(toggle);
      row.appendChild(swatch);
      row.appendChild(label);
      listContainer.appendChild(row);
    }
  };

  // Listen for template creation/import completion to (re)build palette list
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try { buildColorFilterList(); } catch (_) {}
    }
  });

  // If a template was already loaded from storage, show the color UI and build list
  setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        const colorUI = document.querySelector('#bm-contain-colorfilter');
        if (colorUI) { colorUI.style.display = ''; }
        buildColorFilterList();
      }
    } catch (_) {}
  }, 0);
}

// Telemetry overlay removed

function buildOverlayTabTemplate() {
  overlayTabTemplate.addDiv({'id': 'bm-tab-template', 'style': 'top: 20%; left: 10%;'})
      .addDiv()
        .addDiv({'className': 'bm-dragbar'}).buildElement()
        .addButton({'className': 'bm-button-minimize', 'textContent': '↑'},
          (instance, button) => {
            button.onclick = () => {
              let isMinimized = false;
              if (button.textContent == '↑') {
                button.textContent = '↓';
              } else {
                button.textContent = '↑';
                isMinimized = true;
              }

              
            }
          }
        ).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay();
}
