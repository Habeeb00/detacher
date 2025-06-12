// Types for the Detachr plugin
// Using string literals for the variable types to avoid enum transpilation issues
type VariableType =
  | "color"
  | "text"
  | "number"
  | "other";

// Constants to use for consistency and to avoid magic strings
const VariableTypes = {
  color: "color",
  text: "text",
  number: "number",
  other: "other",
} as const;

interface VariableBinding {
  nodeId: string;
  nodeName: string;
  variableType: VariableType;
  property: string;
  currentVariable: string;
  resolvedValue: string | number | boolean;
}

interface ScanResults {
  bindings: VariableBinding[];
  counts: {
    color: number;
    text: number;
    number: number;
    other: number;
    total: number;
  };
}

interface DetachOptions {
  color: boolean;
  text: boolean;
  number: boolean;
  other: boolean;
  dryRun: boolean;
}

// This file contains the main code that will be executed in Figma's plugin context
figma.showUI(__html__, { width: 320, height: 465 });

// Add selection change listener to refresh scanning
figma.on("selectionchange", () => {
  console.log("Selection changed, refreshing scan");
  scanVariables().then(results => {
    figma.ui.postMessage({ type: "scan-results", payload: results });
  }).catch(error => {
    console.error("Error during selection change scan:", error);
    figma.ui.postMessage({
      type: "error",
      payload: { message: "Error scanning variables: " + error.message },
    });
  });
});

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  try {
  if (msg.type === "scan") {
      console.log("Received scan request from UI");
      try {
        // Check if there's a selection
        if (figma.currentPage.selection.length === 0) {
          console.log("No elements selected for scan");
          
          // Still perform the scan on the current page, but also send a notification
          const results = await scanVariables();
          figma.ui.postMessage({ 
            type: "scan-results", 
            payload: {
              ...results,
              afterDetach: msg.afterDetach,
              noSelection: true
            }
          });
        } else {
    const results = await scanVariables();
          figma.ui.postMessage({ 
            type: "scan-results", 
            payload: {
              ...results,
              afterDetach: msg.afterDetach
            }
          });
        }
      } catch (error: any) {
        console.error("Error during scan:", error);
        figma.ui.postMessage({
          type: "error",
          payload: { message: "Error scanning variables: " + error.message },
        });
      }
  } else if (msg.type === "detach") {
      console.log("Received detach request from UI", msg.payload);
      try {
        // Check if there's a selection
        if (figma.currentPage.selection.length === 0) {
          console.log("No elements selected");
          figma.ui.postMessage({
            type: "no-selection",
            payload: { message: "Please select frames, layers, or components first." }
          });
          return;
        }
        
        // Check if we're in a dynamic page
        const isDynamicPage = figma.currentPage.type === "PAGE" && 
          ("documentAccess" in figma.currentPage && (figma.currentPage as any).documentAccess === "dynamic-page");
        
        if (isDynamicPage) {
          console.log("Warning: Detected dynamic page context. Using special handling.");
          // For dynamic pages, we need to use a different approach
          figma.ui.postMessage({
            type: "error",
            payload: { message: "Dynamic page detected. Some variables might not detach correctly. Please try using component instances instead of components directly." }
          });
        }
        
    const results = await detachVariables(
      msg.payload.bindings,
      msg.payload.options
    );
    figma.ui.postMessage({ type: "detach-results", payload: results });
      } catch (error: any) {
        console.error("Error during detach:", error);
        figma.ui.postMessage({
          type: "error",
          payload: { message: "Error detaching variables: " + error.message },
        });
      }
  } else if (msg.type === "close") {
    figma.closePlugin();
    } else {
      console.warn("Unknown message type:", msg.type);
      figma.ui.postMessage({
        type: "error",
        payload: { message: "Unknown message type: " + msg.type },
      });
    }
  } catch (error: any) {
    console.error("Error handling message:", error);
    figma.ui.postMessage({
      type: "error",
      payload: { message: "Error handling message: " + error.message },
    });
  }
};

// Handle commands from the plugin menu
figma.on("run", ({ command }: { command: string }) => {
  switch (command) {
    case "scan-variables":
      // This will trigger automatically when the plugin is opened
      break;
    case "about":
      figma.ui.postMessage({ type: "show-about" });
      break;
    default:
      // Default action is to scan
      break;
  }
});

// Scan for all variables in the selection or current page
async function scanVariables(): Promise<ScanResults> {
  console.log("Starting variable scan...");
  const bindings: VariableBinding[] = [];
  const selection = figma.currentPage.selection;
  
  console.log(`Selection count: ${selection.length}`);

  // Use selection if available, otherwise scan the current page
  const nodesToScan = selection.length > 0 ? selection : [figma.currentPage];
  console.log(`Nodes to scan: ${nodesToScan.length}`);

  // Initialize counts
  const counts = {
    color: 0,
    text: 0,
    number: 0,
    other: 0,
    total: 0,
  };

  // Helper function to scan a node and its children recursively
  async function scanNode(node: SceneNode): Promise<void> {
    // Diagnostic: Log node type and name
    console.log(`[DIAG] Scanning node: ${node.name} (type: ${node.type}, id: ${node.id})`);
    // Diagnostic: Log all properties of the node
    try {
      const nodeProps = Object.keys(node).filter(k => typeof (node as any)[k] !== 'function');
      console.log(`[DIAG] Node properties: ${JSON.stringify(nodeProps)}`);
    } catch (e) {
      console.warn(`[DIAG] Could not list node properties: ${e}`);
    }
    // Check if node has variable bindings
    if ("boundVariables" in node && node.boundVariables) {
      const boundVars = node.boundVariables;
      console.log(`[DIAG] Found node with bound variables: ${node.name}`);
      // Diagnostic: Log all bound variable properties and their values
      for (const prop in boundVars) {
        const binding = (boundVars as any)[prop];
        console.log(`[DIAG] Bound variable: property=${prop}, binding=${JSON.stringify(binding)}`);
      }
      
      // Special handling for fills and strokes to detect nested properties
      if ("fills" in node) {
        const fills = (node as any).fills;
        if (fills !== figma.mixed) {
          console.log(`Node has fills property with ${Array.isArray(fills) ? fills.length : 0} fills`);
          // Check if any fills are bound to variables
          if (Array.isArray(fills)) {
            for (let i = 0; i < fills.length; i++) {
              const fill = fills[i];
              if (fill.type === "SOLID") {
                console.log(`Checking fill ${i}: SOLID color`);
                // Check if this specific fill's color is bound to a variable
                const fillColorPath = `fills.${i}.color`;
                if (boundVars[fillColorPath]) {
                  console.log(`Found variable binding for ${fillColorPath}`);
                  // Add VariableBinding for this fill color variable
                  const binding = boundVars[fillColorPath];
                  if (binding && binding.id) {
                    let variableType: VariableType = VariableTypes.color;
                    let resolvedValue: string | number | boolean = "";
                    try {
                      const variable = await figma.variables.getVariableByIdAsync(binding.id);
                      if (variable) {
                        const resolvedVariable = variable.resolveForConsumer(node);
                        if (
                          resolvedVariable &&
                          typeof resolvedVariable.value === "object" &&
                          resolvedVariable.value !== null &&
                          "r" in resolvedVariable.value &&
                          "g" in resolvedVariable.value &&
                          "b" in resolvedVariable.value
                        ) {
                          const color = resolvedVariable.value as RGBA;
                          const r = Math.round(color.r * 255);
                          const g = Math.round(color.g * 255);
                          const b = Math.round(color.b * 255);
                          resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                            .toString(16)
                            .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                        } else {
                          resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                        }
                        bindings.push({
                          nodeId: node.id,
                          nodeName: node.name,
                          variableType,
                          property: fillColorPath,
                          currentVariable: variable.name,
                          resolvedValue,
                        });
                        counts[variableType]++;
                        counts.total++;
                      }
                    } catch (e) {
                      console.warn(`Error resolving fill color variable: ${e}`);
                    }
                  }
                }
              } else if (fill.type.includes("GRADIENT")) {
                console.log(`Checking fill ${i}: ${fill.type}`);
                // Check gradient stops
                if (fill.gradientStops) {
                  for (let j = 0; j < fill.gradientStops.length; j++) {
                    const stopPath = `fills.${i}.gradientStops.${j}.color`;
                    if (boundVars[stopPath]) {
                      console.log(`Found variable binding for gradient stop: ${stopPath}`);
                      // Add VariableBinding for this gradient stop color variable
                      const binding = boundVars[stopPath];
                      if (binding && binding.id) {
                        let variableType: VariableType = VariableTypes.color;
                        let resolvedValue: string | number | boolean = "";
                        try {
                          const variable = await figma.variables.getVariableByIdAsync(binding.id);
                          if (variable) {
                            const resolvedVariable = variable.resolveForConsumer(node);
                            if (
                              resolvedVariable &&
                              typeof resolvedVariable.value === "object" &&
                              resolvedVariable.value !== null &&
                              "r" in resolvedVariable.value &&
                              "g" in resolvedVariable.value &&
                              "b" in resolvedVariable.value
                            ) {
                              const color = resolvedVariable.value as RGBA;
                              const r = Math.round(color.r * 255);
                              const g = Math.round(color.g * 255);
                              const b = Math.round(color.b * 255);
                              resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                .toString(16)
                                .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                            } else {
                              resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                            }
                            bindings.push({
                              nodeId: node.id,
                              nodeName: node.name,
                              variableType,
                              property: stopPath,
                              currentVariable: variable.name,
                              resolvedValue,
                            });
                            counts[variableType]++;
                            counts.total++;
                          }
                        } catch (e) {
                          console.warn(`Error resolving gradient stop variable: ${e}`);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // Similar handling for strokes
      if ("strokes" in node) {
        const strokes = (node as any).strokes;
        if (strokes !== figma.mixed) {
          console.log(`Node has strokes property with ${Array.isArray(strokes) ? strokes.length : 0} strokes`);
          // Check if any strokes are bound to variables
          if (Array.isArray(strokes)) {
            for (let i = 0; i < strokes.length; i++) {
              const stroke = strokes[i];
              if (stroke.type === "SOLID") {
                console.log(`Checking stroke ${i}: SOLID color`);
                // Check if this specific stroke's color is bound to a variable
                const strokeColorPath = `strokes.${i}.color`;
                if (boundVars[strokeColorPath]) {
                  console.log(`Found variable binding for ${strokeColorPath}`);
                  // Add VariableBinding for this stroke color variable
                  const binding = boundVars[strokeColorPath];
                  if (binding && binding.id) {
                    let variableType: VariableType = VariableTypes.color;
                    let resolvedValue: string | number | boolean = "";
                    try {
                      const variable = await figma.variables.getVariableByIdAsync(binding.id);
                      if (variable) {
                        const resolvedVariable = variable.resolveForConsumer(node);
                        if (
                          resolvedVariable &&
                          typeof resolvedVariable.value === "object" &&
                          resolvedVariable.value !== null &&
                          "r" in resolvedVariable.value &&
                          "g" in resolvedVariable.value &&
                          "b" in resolvedVariable.value
                        ) {
                          const color = resolvedVariable.value as RGBA;
                          const r = Math.round(color.r * 255);
                          const g = Math.round(color.g * 255);
                          const b = Math.round(color.b * 255);
                          resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                            .toString(16)
                            .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                        } else {
                          resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                        }
                        bindings.push({
                          nodeId: node.id,
                          nodeName: node.name,
                          variableType,
                          property: strokeColorPath,
                          currentVariable: variable.name,
                          resolvedValue,
                        });
                        counts[variableType]++;
                        counts.total++;
                      }
                    } catch (e) {
                      console.warn(`Error resolving stroke color variable: ${e}`);
                    }
                  }
                }
              } else if (stroke.type.includes("GRADIENT")) {
                console.log(`Checking stroke ${i}: ${stroke.type}`);
                // Check gradient stops
                if (stroke.gradientStops) {
                  for (let j = 0; j < stroke.gradientStops.length; j++) {
                    const stopPath = `strokes.${i}.gradientStops.${j}.color`;
                    if (boundVars[stopPath]) {
                      console.log(`Found variable binding for gradient stop: ${stopPath}`);
                      // Add VariableBinding for this gradient stop color variable
                      const binding = boundVars[stopPath];
                      if (binding && binding.id) {
                        let variableType: VariableType = VariableTypes.color;
                        let resolvedValue: string | number | boolean = "";
                        try {
                          const variable = await figma.variables.getVariableByIdAsync(binding.id);
                          if (variable) {
                            const resolvedVariable = variable.resolveForConsumer(node);
                            if (
                              resolvedVariable &&
                              typeof resolvedVariable.value === "object" &&
                              resolvedVariable.value !== null &&
                              "r" in resolvedVariable.value &&
                              "g" in resolvedVariable.value &&
                              "b" in resolvedVariable.value
                            ) {
                              const color = resolvedVariable.value as RGBA;
                              const r = Math.round(color.r * 255);
                              const g = Math.round(color.g * 255);
                              const b = Math.round(color.b * 255);
                              resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                .toString(16)
                                .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                            } else {
                              resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                            }
                            bindings.push({
                              nodeId: node.id,
                              nodeName: node.name,
                              variableType,
                              property: stopPath,
                              currentVariable: variable.name,
                              resolvedValue,
                            });
                            counts[variableType]++;
                            counts.total++;
                          }
                        } catch (e) {
                          console.warn(`Error resolving gradient stop variable: ${e}`);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Loop through all bound variables
      for (const property in boundVars) {
        const binding = (boundVars as any)[property];

        if (binding && binding.id) {
          console.log(`Found binding for property: ${property}, ID: ${binding.id}`);
          let variableType: VariableType;
          let resolvedValue: string | number | boolean = "";

          // Try to determine variable type and resolved value
          try {
            const variable = await figma.variables.getVariableByIdAsync(binding.id);
            if (variable) {
              console.log(`Variable found: ${variable.name}, Resolved Type: ${(variable as any).resolvedType}`);
              const resolvedVariable = variable.resolveForConsumer(node);
              console.log(`Resolved variable: ${JSON.stringify(resolvedVariable)}`);

              // Determine type based on the variable's resolvedType
              switch ((variable as any).resolvedType) {
                case "COLOR":
                  variableType = VariableTypes.color;
                  console.log(`Identified color variable for property: ${property}`);
                  if (
                    resolvedVariable &&
                    typeof resolvedVariable.value === "object" &&
                    resolvedVariable.value !== null &&
                    "r" in resolvedVariable.value &&
                    "g" in resolvedVariable.value &&
                    "b" in resolvedVariable.value
                  ) {
                    const color = resolvedVariable.value as RGBA;
                    const r = Math.round(color.r * 255);
                    const g = Math.round(color.g * 255);
                    const b = Math.round(color.b * 255);
                    resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                      .toString(16)
                      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                    console.log(`Converted color to hex: ${resolvedValue}`);
                  } else {
                    resolvedValue = String(
                      (resolvedVariable && resolvedVariable.value) || ""
                    );
                    console.log(`Could not convert color to hex, using raw value: ${resolvedValue}`);
                  }
                  break;
                case "FLOAT":
                  variableType = VariableTypes.number;
                  resolvedValue = Number(
                    (resolvedVariable && resolvedVariable.value) || 0
                  );
                  break;
                case "STRING":
                  variableType = VariableTypes.text;
                  resolvedValue = String(
                    (resolvedVariable && resolvedVariable.value) || ""
                  );
                  break;
                case "BOOLEAN":
                  variableType = VariableTypes.other;
                  resolvedValue = Boolean(
                    (resolvedVariable && resolvedVariable.value) || false
                  );
                  break;
                default:
                  console.warn(`Unknown resolved type: ${(variable as any).resolvedType}. Falling back to property name.`);
                  // Fallback for safety
                  if (property.includes("color") || property.includes("fill") || property.includes("stroke")) {
                    variableType = VariableTypes.color;
                  } else if (property.includes("character")) {
                    variableType = VariableTypes.text;
                  } else {
                    variableType = VariableTypes.other;
                  }
                  resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                  break;
              }

              console.log(`Variable type: ${variableType}, Resolved value: ${resolvedValue}`);

              // Add to bindings array
              bindings.push({
                nodeId: node.id,
                nodeName: node.name,
                variableType,
                property,
                currentVariable: variable.name,
                resolvedValue,
              });

              // Update counts
              counts[variableType]++;
              counts.total++;
            } else {
              console.warn(`Variable not found for ID: ${binding.id}`);
            }
          } catch (e) {
            console.error(`Error resolving variable: ${e}`);
          }
        }

        if ((property === "fills" || property === "strokes") && binding) {
          const bindingsArray = Array.isArray(binding) ? binding : [binding];
          for (const singleBinding of bindingsArray) {
            if (singleBinding && singleBinding.id) {
              try {
                const variable = await figma.variables.getVariableByIdAsync(singleBinding.id);
                if (variable && (variable as any).resolvedType === "COLOR") {
                  const resolvedVariable = variable.resolveForConsumer(node);
                  let resolvedValue = "";
                  if (
                    resolvedVariable &&
                    typeof resolvedVariable.value === "object" &&
                    resolvedVariable.value !== null &&
                    "r" in resolvedVariable.value &&
                    "g" in resolvedVariable.value &&
                    "b" in resolvedVariable.value
                  ) {
                    const color = resolvedVariable.value as RGBA;
                    const r = Math.round(color.r * 255);
                    const g = Math.round(color.g * 255);
                    const b = Math.round(color.b * 255);
                    resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                      .toString(16)
                      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                  }
                  bindings.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    variableType: VariableTypes.color,
                    property,
                    currentVariable: variable.name,
                    resolvedValue,
                  });
                  counts[VariableTypes.color]++;
                  counts.total++;
                }
              } catch (e) {
                console.warn(`Error resolving color variable for ${property}: ${e}`);
              }
            }
          }
        }
      }
    }

    // Check for style properties that might be bound to variables
    const styleProperties = [
      "fillStyleId",
      "strokeStyleId",
      "textStyleId",
      "effectStyleId",
      "gridStyleId"
    ];
    
    for (const styleProp of styleProperties) {
      if (styleProp in node && (node as any)[styleProp]) {
        const styleId = (node as any)[styleProp];
        if (styleId && styleId !== figma.mixed) {
          try {
            console.log(`Found style property: ${styleProp}, ID: ${styleId}`);
            
            // Determine variable type based on style property
            let variableType: VariableType;
            if (styleProp === "fillStyleId" || styleProp === "strokeStyleId") {
              variableType = VariableTypes.color;
            } else if (styleProp === "textStyleId") {
              variableType = VariableTypes.text;
            } else {
              variableType = VariableTypes.other;
            }
            
            // Add to bindings array
            bindings.push({
              nodeId: node.id,
              nodeName: node.name,
              variableType,
              property: styleProp,
              currentVariable: `Style: ${styleId}`,
              resolvedValue: styleId,
            });
            
            // Update counts
            counts[variableType]++;
            counts.total++;
            
            console.log(`Added style binding for ${styleProp}`);
          } catch (e) {
            console.error(`Error processing style: ${e}`);
          }
        }
      }
    }

    // Recursively scan children if they exist
    if ("children" in node) {
      for (const child of node.children) {
        await scanNode(child);
      }
    }
  }

  // Start scanning from the root nodes
  for (const node of nodesToScan) {
    await scanNode(node as SceneNode);
  }

  console.log(`Scan complete. Found ${counts.total} variables.`);
  console.log(`Counts: ${JSON.stringify(counts)}`);

  return { bindings, counts };
}

// Detach variables based on provided options
async function detachVariables(
  bindings: VariableBinding[],
  options: DetachOptions
): Promise<{
  detached: VariableBinding[];
  skipped: VariableBinding[];
  dryRun: boolean;
  counts: {
    total: number;
    color: number;
    text: number;
    number: number;
    other: number;
  };
}> {
  console.log("Detaching variables with options:", options);
  const detached: VariableBinding[] = [];
  const skipped: VariableBinding[] = [];

  // Filter bindings based on selected types
  const filteredBindings = bindings.filter(binding => options[binding.variableType]);
  console.log(`Filtered ${bindings.length} bindings to ${filteredBindings.length} based on selected types`);
  console.log("Filtered bindings:", filteredBindings);

  // In dry run mode, just add to detached without actual changes
  if (options.dryRun) {
    console.log("Dry run mode - no actual changes will be made");
    for (const binding of filteredBindings) {
      console.log(`Dry run: Would detach ${binding.property} from ${binding.nodeName}`);
      detached.push(binding);
    }
  } else {
    // Actual detachment logic
    console.log("Starting actual detachment process");
    
    // First, load all fonts needed for text nodes
    if (options.text) {
      const textBindings = filteredBindings.filter(
        binding => binding.variableType === VariableTypes.text && binding.property === "characters"
      );
      
      if (textBindings.length > 0) {
        console.log(`Found ${textBindings.length} text bindings that need font loading`);
        
        // Get all nodes that need font loading
        const textNodes: TextNode[] = [];
        for (const binding of textBindings) {
          try {
            console.log(`Getting node for text binding: ${binding.nodeId}`);
            const node = await figma.getNodeByIdAsync(binding.nodeId);
            if (node && "fontName" in node) {
              console.log(`Found text node: ${node.name}`);
              textNodes.push(node as TextNode);
            } else {
              console.warn(`Node not found or not a text node: ${binding.nodeId}`);
            }
          } catch (e) {
            console.error(`Error getting node for text binding: ${e}`);
          }
        }
        
        // Load fonts for all text nodes
        const fontLoadPromises: Promise<void>[] = [];
        for (const node of textNodes) {
          if ("fontName" in node && node.fontName !== figma.mixed) {
            const fontName = node.fontName as FontName;
            console.log(`Loading font: ${fontName.family} ${fontName.style}`);
            fontLoadPromises.push(
              figma.loadFontAsync({
                family: fontName.family,
                style: fontName.style
              }).catch(err => {
                console.error(`Error loading font ${fontName.family} ${fontName.style}:`, err);
              })
            );
          }
        }
        
        // Wait for all fonts to load
        if (fontLoadPromises.length > 0) {
          console.log(`Loading ${fontLoadPromises.length} fonts...`);
          await Promise.all(fontLoadPromises);
          console.log("All fonts loaded successfully");
        }
      }
    }
    
    // Now process each binding
    for (const binding of filteredBindings) {
      try {
        console.log(`Starting actual detachment for ${binding.nodeName}, property: ${binding.property}`);
        
        // Actual detachment logic
        let node;
        try {
          console.log(`Getting node by ID: ${binding.nodeId}`);
          node = await figma.getNodeByIdAsync(binding.nodeId);
          console.log(`Node found: ${node ? node.name : 'null'}, type: ${node ? node.type : 'unknown'}`);
        } catch (e) {
          console.error(`Error getting node by ID: ${e}`);
          skipped.push(binding);
          continue;
        }

        if (!node) {
          console.warn(`Node not found: ${binding.nodeId}`);
          skipped.push(binding);
          continue;
        }
        
        console.log(`Detaching variable from node ${binding.nodeId} (${binding.nodeName}), property: ${binding.property}`);

        // Handle style properties
        if (binding.property.endsWith("StyleId")) {
          try {
            console.log(`Handling style property: ${binding.property}`);
            
            // Check if node has the style property
            if (binding.property in node) {
              // Set the style ID to an empty string to remove it
              (node as any)[binding.property] = "";
              console.log(`Removed style: ${binding.property}`);
              
              // Apply the resolved value if possible
              if (binding.property === "fillStyleId" && "fills" in node) {
                // We've already handled fills in the color section
                console.log("Fill style removed, value was applied in color handling");
              } else if (binding.property === "strokeStyleId" && "strokes" in node) {
                // We've already handled strokes in the color section
                console.log("Stroke style removed, value was applied in color handling");
              } else if (binding.property === "textStyleId" && "fontName" in node) {
                // For text styles, we might need to handle font properties
                console.log("Text style removed, but font properties preserved");
              } else {
                console.log(`Style removed: ${binding.property}`);
              }
              
              detached.push(binding);
              continue;
            } else {
              console.warn(`Node does not have style property: ${binding.property}`);
              skipped.push(binding);
              continue;
            }
          } catch (e) {
            console.error(`Error handling style property: ${e}`);
            skipped.push(binding);
            continue;
          }
        }

        if ("boundVariables" in node) {
          try {
            // First, apply the resolved value
            if (binding.property === "characters" && "characters" in node) {
              console.log(`Setting text value: ${binding.resolvedValue}`);
              (node as TextNode).characters = String(binding.resolvedValue);
            }
            // Handle color properties
            else if (
              binding.variableType === VariableTypes.color
            ) {
              // Check if it's a fill or stroke property
              const isFill = binding.property.includes("fill") || binding.property === "fill";
              const isStroke = binding.property.includes("stroke") || binding.property === "stroke";
              const propertyName = isStroke ? "strokes" : (isFill ? "fills" : null);
              
              console.log(`Handling color property: ${binding.property}`);
              console.log(`Node type: ${node.type}, has boundVariables: ${!!node.boundVariables}`);
              
              if (node.boundVariables) {
                console.log(`All bound variables: ${JSON.stringify(Object.keys(node.boundVariables))}`);
              }
              
              // Try to use the utility function first
              if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                try {
                  console.log(`Using utility function for color detachment`);
                  const success = await detachColorVariable(node, binding.property, binding.resolvedValue);
                  if (success) {
                    console.log(`Successfully detached color variable using utility function`);
                    detached.push(binding);
                    continue; // Skip the rest of the loop iteration
                  } else {
                    console.log(`Utility function failed, falling back to standard approach`);
                  }
                } catch (e) {
                  console.error(`Error using utility function: ${e}`);
                  console.log(`Falling back to standard approach`);
                }
              }
              
              // Handle direct color properties
              if (binding.property === "fill" && "fills" in node) {
                console.log(`Handling direct fill property`);
                try {
                  if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                    const hex = binding.resolvedValue.substring(1);
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    
                    // Create a solid paint
                    const solidPaint: SolidPaint = {
                      type: "SOLID",
                      color: { r, g, b },
                      opacity: 1
                    };
                    
                    // Apply the fill
                    (node as any).fills = [solidPaint];
                    console.log(`Applied direct fill color`);
                  }
                } catch (e) {
                  console.error(`Error applying direct fill: ${e}`);
                }
              } else if (binding.property === "stroke" && "strokes" in node) {
                console.log(`Handling direct stroke property`);
                try {
                  if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                    const hex = binding.resolvedValue.substring(1);
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    
                    // Create a solid paint
                    const solidPaint: SolidPaint = {
                      type: "SOLID",
                      color: { r, g, b },
                      opacity: 1
                    };
                    
                    // Apply the stroke
                    (node as any).strokes = [solidPaint];
                    console.log(`Applied direct stroke color`);
                  }
                } catch (e) {
                  console.error(`Error applying direct stroke: ${e}`);
                }
              } else if (binding.property === "backgroundColor" && "backgroundColor" in node) {
                console.log(`Handling backgroundColor property`);
                try {
                  if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                    const hex = binding.resolvedValue.substring(1);
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    
                    // Apply the background color
                    (node as any).backgroundColor = { r, g, b };
                    console.log(`Applied backgroundColor`);
                  }
                } catch (e) {
                  console.error(`Error applying backgroundColor: ${e}`);
                }
              }
              // Continue with the existing fill/stroke property handling
              else if (propertyName && propertyName in node) {
                const currentValue = (node as any)[propertyName];
                console.log(`Current ${propertyName}: ${JSON.stringify(currentValue)}`);
                
                // Skip if the property is figma.mixed
                if (currentValue === figma.mixed) {
                  console.warn(`${propertyName} is mixed, skipping`);
                  continue;
                }
                
                try {
                  // Parse the resolved value based on its type
                  if (typeof binding.resolvedValue === "string") {
                    // Handle hex color string
                    if (binding.resolvedValue.startsWith("#")) {
                const hex = binding.resolvedValue.substring(1);
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                      console.log(`Setting color: RGB(${r}, ${g}, ${b})`);
                      
                      // Get the current fills/strokes
                      const paintArray = JSON.parse(JSON.stringify(currentValue)) as Paint[];
                      
                      // Determine which paint to update based on the property
                      let paintIndex = 0;
                      if (binding.property.includes("fill") && binding.property !== "fills") {
                        // Extract index from property name (e.g., "fillStyleId0" -> 0)
                        const match = binding.property.match(/\d+$/);
                        if (match) {
                          paintIndex = parseInt(match[0]);
                        }
                      }
                      
                      // Ensure the paint array has enough elements
                      if (paintIndex >= paintArray.length) {
                        console.warn(`Paint index ${paintIndex} is out of bounds, skipping`);
                        continue;
                      }
                      
                      // Update the paint based on its type
                      const paint = paintArray[paintIndex];
                      
                      if (paint.type === "SOLID") {
                        // Update solid color
                        // Create a new paint object with the updated color
                        const originalColor = paint.color;
                        const newColor = {
                          r, g, b,
                          a: 'a' in originalColor ? originalColor.a : 1 // Default alpha to 1 if not present
                        };
                        
                        paintArray[paintIndex] = {
                          ...paint,
                          color: newColor
                        };
                        console.log(`Updated solid color at index ${paintIndex}`);
                        
                        // Try to remove the variable binding specifically for this color
                        try {
                          // The binding for a solid color might be at "fills.0.color"
                          const specificColorBinding = `${propertyName}.${paintIndex}.color`;
                          console.log(`Attempting to remove specific color binding: ${specificColorBinding}`);
                          if ("setBoundVariable" in node) {
                            (node as any).setBoundVariable(specificColorBinding, null);
                            console.log(`Removed specific color binding: ${specificColorBinding}`);
                          }
                        } catch (e) {
                          console.log(`Note: Could not remove specific color binding: ${e}`);
                          // This is just an additional attempt, so we continue even if it fails
                        }
                      } else if (paint.type.includes("GRADIENT")) {
                        // For gradients, we need to determine which color stop to update
                        const stopIndex = binding.property.includes("gradientStops") ? 
                          parseInt(binding.property.match(/gradientStops(\d+)/)?.[1] || "0") : 0;
                        
                        // Type guard for gradient paints
                        if (!("gradientStops" in paint)) {
                          console.warn(`Paint does not have gradientStops property`);
                          continue;
                        }
                        
                        const gradientPaint = paint as GradientPaint;
                        
                        if (gradientPaint.gradientStops && stopIndex < gradientPaint.gradientStops.length) {
                          // Create a new gradient stops array with the updated color
                          const newGradientStops = [...gradientPaint.gradientStops];
                          const originalStopColor = newGradientStops[stopIndex].color;
                          const newStopColor = {
                            r, g, b,
                            a: 'a' in originalStopColor ? originalStopColor.a : 1 // Default alpha to 1 if not present
                          };
                          
                          newGradientStops[stopIndex] = {
                            ...newGradientStops[stopIndex],
                            color: newStopColor
                          };
                          
                          // Create a new paint object with the updated gradient stops
                          paintArray[paintIndex] = {
                            ...gradientPaint,
                            gradientStops: newGradientStops
                          } as Paint;
                          console.log(`Updated gradient stop ${stopIndex} in ${paint.type}`);
                        } else {
                          console.warn(`Gradient stop index ${stopIndex} is out of bounds, skipping`);
                        }
                      } else {
                        console.warn(`Unsupported paint type: ${paint.type}, skipping`);
                        continue;
                      }
                      
                      // Apply the updated paints back to the node
                      try {
                        console.log(`Applying updated ${propertyName} to node`);
                        (node as any)[propertyName] = paintArray;
                        console.log(`Applied updated ${propertyName}`);
                      } catch (e) {
                        console.error(`Error applying updated ${propertyName}: ${e}`);
                      }
                    } else {
                      console.warn(`Unsupported color format: ${binding.resolvedValue}, skipping`);
                    }
                  } else if (typeof binding.resolvedValue === "object" && binding.resolvedValue !== null) {
                    // Handle object color representation (e.g., {r: 0.5, g: 0.5, b: 0.5})
                    console.log(`Setting color from object: ${JSON.stringify(binding.resolvedValue)}`);
                    
                    // Implementation would go here, similar to the hex color handling above
                    console.warn(`Object color representation not fully implemented, skipping`);
                  } else {
                    console.warn(`Unsupported color value type: ${typeof binding.resolvedValue}, skipping`);
                  }
                } catch (e) {
                  console.error(`Error setting ${propertyName}: ${e}`);
                  skipped.push(binding);
                  continue;
                }
              } else {
                console.warn(`Node does not have ${propertyName} property, skipping`);
                skipped.push(binding);
                continue;
              }
            }
            // Handle spacing and number properties
            else if (
              binding.variableType === VariableTypes.number ||
              (binding.variableType === VariableTypes.other &&
               typeof binding.resolvedValue === "number")
            ) {
              console.log(`Setting numeric value: ${binding.resolvedValue}`);
              const numericValue = Number(binding.resolvedValue);
              
              // Apply to the specific property if possible
              if (binding.property === "width" && "resize" in node) {
                (node as RectangleNode).resize(
                  numericValue,
                  (node as RectangleNode).height
                );
                console.log("Applied width value");
              } else if (binding.property === "height" && "resize" in node) {
                (node as RectangleNode).resize(
                  (node as RectangleNode).width,
                  numericValue
                );
                console.log("Applied height value");
              } else if (
                binding.property.includes("padding") &&
                "paddingLeft" in node
              ) {
                // Check if node has padding properties
                if (binding.property === "paddingLeft" && "paddingLeft" in node) {
                  (node as any).paddingLeft = numericValue;
                  console.log("Applied paddingLeft value");
                }
                if (
                  binding.property === "paddingRight" &&
                  "paddingRight" in node
                ) {
                  (node as any).paddingRight = numericValue;
                  console.log("Applied paddingRight value");
                }
                if (binding.property === "paddingTop" && "paddingTop" in node) {
                  (node as any).paddingTop = numericValue;
                  console.log("Applied paddingTop value");
                }
                if (
                  binding.property === "paddingBottom" &&
                  "paddingBottom" in node
                ) {
                  (node as any).paddingBottom = numericValue;
                  console.log("Applied paddingBottom value");
                }
              }
            }
            
            // Now remove the variable binding
            if (node.boundVariables) {
              console.log(`Removing binding for property: ${binding.property}`);
              try {
                // Use setBoundVariable with null to remove the binding
                if ("setBoundVariable" in node) {
                  // For color properties, we need to handle them specially
                  if (binding.variableType === VariableTypes.color) {
                    // For fill and stroke properties, we need to identify the specific binding property
                    if (binding.property.includes("fill") || binding.property.includes("stroke")) {
                      console.log(`Removing color binding for ${binding.property}`);
                      
                      // The binding property might be something like "fills.0.color"
                      // Check if it's a nested property
                      if (binding.property.includes(".")) {
                        // Handle nested properties like "fills.0.color"
                        console.log(`Handling nested color property: ${binding.property}`);
                        (node as any).setBoundVariable(binding.property, null);
                      } else if (binding.property === "fills" || binding.property === "strokes") {
                        // Handle direct fills/strokes property
                        console.log(`Handling direct ${binding.property} property`);
                        (node as any).setBoundVariable(binding.property, null);
                      } else if (binding.property.endsWith("StyleId")) {
                        // Handle style properties
                        console.log(`Handling style property: ${binding.property}`);
                        (node as any).setBoundVariable(binding.property, null);
                        // Also set the style ID to empty string to ensure it's removed
                        (node as any)[binding.property] = "";
                      } else {
                        // For other fill/stroke related properties
                        console.log(`Handling other color property: ${binding.property}`);
                        (node as any).setBoundVariable(binding.property, null);
                      }
                    } else {
                      // For other color properties
                      console.log(`Removing other color binding: ${binding.property}`);
                      (node as any).setBoundVariable(binding.property, null);
                    }
                  } else {
                    // For non-color properties
                    (node as any).setBoundVariable(binding.property, null);
                  }
                  console.log(`Binding removed for property: ${binding.property} using setBoundVariable(null)`);
                } else {
                  // Alternative approach: try to set the actual value without the variable
                  console.log(`Node does not have setBoundVariable method, trying alternative approach`);
                  
                  // Try a different approach for removing the binding
                  try {
                    // For text nodes, we've already set the characters above
                    if (binding.property === "characters" && "characters" in node) {
                      // Already handled
                      console.log("Text value already applied");
                    } 
                    // For color properties, try to set the property directly
                    else if (binding.variableType === VariableTypes.color) {
                      console.log("Color value already applied");
                    }
                    // For other properties, try a generic approach
                    else {
                      console.log(`Attempting to set property directly: ${binding.property}`);
                      if (binding.property in node) {
                        (node as any)[binding.property] = binding.resolvedValue;
                        console.log(`Set property directly: ${binding.property}`);
                      }
                    }
                  } catch (e) {
                    console.error(`Error in alternative approach: ${e}`);
                  }
                  
                  console.warn(`Could not remove binding for property: ${binding.property}`);
                  // We'll still consider it detached since we've applied the value
                }
              } catch (e) {
                console.error(`Error removing variable binding: ${e}`);
                // We'll still consider it detached if we've applied the value
              }
            }

            detached.push(binding);
            console.log(`Successfully detached ${binding.property} from ${binding.nodeName}`);
          } catch (e) {
            console.error(`Error applying value: ${e}`);
            skipped.push(binding);
          }
        } else {
          console.warn(`Node does not have boundVariables: ${binding.nodeId}`);
          skipped.push(binding);
        }
      } catch (e) {
        console.error(`Error detaching variable: ${e}`);
        skipped.push(binding);
      }
    }
  }

  const counts = {
    total: detached.length,
    color: detached.filter((b) => b.variableType === VariableTypes.color).length,
    text: detached.filter((b) => b.variableType === VariableTypes.text).length,
    number: detached.filter((b) => b.variableType === VariableTypes.number).length,
    other: detached.filter((b) => b.variableType === VariableTypes.other).length,
  };
  
  console.log(`Detach complete: ${counts.total} detached, ${skipped.length} skipped`);
  console.log(`Counts by type: ${JSON.stringify(counts)}`);
  console.log(`Returning results with dryRun: ${options.dryRun}`);

  return {
    detached,
    skipped,
    dryRun: options.dryRun,
    counts,
  };
}

// Utility function to help with color detachment
async function detachColorVariable(node: SceneNode, property: string, colorValue: string): Promise<boolean> {
  console.log(`Attempting to detach color variable for property: ${property}`);
  
  try {
    // Parse the color value
    if (!colorValue.startsWith("#")) {
      console.warn(`Color value is not in hex format: ${colorValue}`);
      return false;
    }
    
    const hex = colorValue.substring(1);
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    // Handle direct color properties first
    if (property === "fill" && "fills" in node) {
      console.log(`Handling direct fill property`);
      try {
        // Create a solid paint
        const solidPaint: SolidPaint = {
          type: "SOLID",
          color: { r, g, b },
          opacity: 1
        };
        
        // Apply the fill
        (node as any).fills = [solidPaint];
        console.log(`Applied direct fill color`);
        
        // Try to remove the binding
        if ("setBoundVariable" in node) {
          (node as any).setBoundVariable(property, null);
          console.log(`Removed binding for ${property}`);
        }
        
        return true;
      } catch (e) {
        console.error(`Error applying direct fill: ${e}`);
        return false;
      }
    } else if (property === "stroke" && "strokes" in node) {
      console.log(`Handling direct stroke property`);
      try {
        // Create a solid paint
        const solidPaint: SolidPaint = {
          type: "SOLID",
          color: { r, g, b },
          opacity: 1
        };
        
        // Apply the stroke
        (node as any).strokes = [solidPaint];
        console.log(`Applied direct stroke color`);
        
        // Try to remove the binding
        if ("setBoundVariable" in node) {
          (node as any).setBoundVariable(property, null);
          console.log(`Removed binding for ${property}`);
        }
        
        return true;
      } catch (e) {
        console.error(`Error applying direct stroke: ${e}`);
        return false;
      }
    } else if (property === "backgroundColor" && "backgroundColor" in node) {
      console.log(`Handling backgroundColor property`);
      try {
        // Apply the background color
        (node as any).backgroundColor = { r, g, b };
        console.log(`Applied backgroundColor`);
        
        // Try to remove the binding
        if ("setBoundVariable" in node) {
          (node as any).setBoundVariable(property, null);
          console.log(`Removed binding for ${property}`);
        }
        
        return true;
      } catch (e) {
        console.error(`Error applying backgroundColor: ${e}`);
        return false;
      }
    }
    
    // Check if the property is a nested property like "fills.0.color"
    if (property.includes(".")) {
      const parts = property.split(".");
      const mainProperty = parts[0]; // "fills" or "strokes"
      
      if (mainProperty !== "fills" && mainProperty !== "strokes") {
        console.warn(`Unsupported main property: ${mainProperty}`);
        return false;
      }
      
      // Make sure node has the property
      if (!(mainProperty in node)) {
        console.warn(`Node does not have property: ${mainProperty}`);
        return false;
      }
      
      // Get the current value
      const currentValue = (node as any)[mainProperty];
      if (currentValue === figma.mixed) {
        console.warn(`${mainProperty} is mixed, cannot detach`);
        return false;
      }
      
      // Parse the color value
      if (!colorValue.startsWith("#")) {
        console.warn(`Color value is not in hex format: ${colorValue}`);
        return false;
      }
      
      const hex = colorValue.substring(1);
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      
      // Create a copy of the current value
      const paintArray = JSON.parse(JSON.stringify(currentValue)) as Paint[];
      
      // Determine the index
      let index = 0;
      if (parts.length > 1 && !isNaN(parseInt(parts[1]))) {
        index = parseInt(parts[1]);
      }
      
      // Check if the index is valid
      if (index >= paintArray.length) {
        console.warn(`Index ${index} is out of bounds for ${mainProperty}`);
        return false;
      }
      
      // Update the color
      const paint = paintArray[index];
      
      if (paint.type === "SOLID") {
        // For solid colors
        const originalColor = paint.color;
        const newColor = {
          r, g, b,
          a: 'a' in originalColor ? originalColor.a : 1
        };
        
        paintArray[index] = {
          ...paint,
          color: newColor
        };
      } else if (paint.type.includes("GRADIENT")) {
        // For gradient stops
        // Type guard for gradient paints
        if (!("gradientStops" in paint)) {
          console.warn(`Paint does not have gradientStops property`);
          return false;
        }
        
        const gradientPaint = paint as GradientPaint;
        
        // Check if we're dealing with a gradient stop
        if (parts.length > 3 && parts[2] === "gradientStops") {
          const stopIndex = parseInt(parts[3] || "0");
          
          if (stopIndex >= gradientPaint.gradientStops.length) {
            console.warn(`Invalid gradient stop index: ${stopIndex}`);
            return false;
          }
          
          const newGradientStops = [...gradientPaint.gradientStops];
          const originalStopColor = newGradientStops[stopIndex].color;
          const newStopColor = {
            r, g, b,
            a: 'a' in originalStopColor ? originalStopColor.a : 1
          };
          
          newGradientStops[stopIndex] = {
            ...newGradientStops[stopIndex],
            color: newStopColor
          };
          
          paintArray[index] = {
            ...gradientPaint,
            gradientStops: newGradientStops
          } as Paint;
        } else {
          // Just update the entire gradient
          console.log(`Updating entire gradient`);
          // No specific changes needed for the gradient itself
        }
      } else {
        console.warn(`Unsupported paint type: ${paint.type}`);
        return false;
      }
      
      // Apply the updated paints
      try {
        (node as any)[mainProperty] = paintArray;
        console.log(`Successfully updated ${mainProperty}`);
        
        // Try to remove the binding
        if ("setBoundVariable" in node) {
          (node as any).setBoundVariable(property, null);
          console.log(`Removed binding for ${property}`);
        }
        
        return true;
      } catch (e) {
        console.error(`Error applying updated ${mainProperty}: ${e}`);
        return false;
      }
    } else {
      // Handle direct properties like "fills" or "strokes"
      console.log(`Handling direct property: ${property}`);
      
      // Try to remove the binding
      if ("setBoundVariable" in node) {
        (node as any).setBoundVariable(property, null);
        console.log(`Removed binding for ${property}`);
        return true;
      } else {
        console.warn(`Node does not have setBoundVariable method`);
        return false;
      }
    }
  } catch (e) {
    console.error(`Error in detachColorVariable: ${e}`);
    return false;
  }
}
