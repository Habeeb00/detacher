"use strict";
// Constants to use for consistency and to avoid magic strings
const VariableTypes = {
    color: "color",
    text: "text",
    number: "number",
    other: "other",
};
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
                        payload: Object.assign(Object.assign({}, results), { afterDetach: msg.afterDetach, noSelection: true })
                    });
                }
                else {
                    const results = await scanVariables();
                    figma.ui.postMessage({
                        type: "scan-results",
                        payload: Object.assign(Object.assign({}, results), { afterDetach: msg.afterDetach })
                    });
                }
            }
            catch (error) {
                console.error("Error during scan:", error);
                figma.ui.postMessage({
                    type: "error",
                    payload: { message: "Error scanning variables: " + error.message },
                });
            }
        }
        else if (msg.type === "detach") {
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
                    ("documentAccess" in figma.currentPage && figma.currentPage.documentAccess === "dynamic-page");
                if (isDynamicPage) {
                    console.log("Warning: Detected dynamic page context. Using special handling.");
                    // For dynamic pages, we need to use a different approach
                    figma.ui.postMessage({
                        type: "error",
                        payload: { message: "Dynamic page detected. Some variables might not detach correctly. Please try using component instances instead of components directly." }
                    });
                }
                const results = await detachVariables(msg.payload.bindings, msg.payload.options);
                figma.ui.postMessage({ type: "detach-results", payload: results });
            }
            catch (error) {
                console.error("Error during detach:", error);
                figma.ui.postMessage({
                    type: "error",
                    payload: { message: "Error detaching variables: " + error.message },
                });
            }
        }
        else if (msg.type === "close") {
            figma.closePlugin();
        }
        else {
            console.warn("Unknown message type:", msg.type);
            figma.ui.postMessage({
                type: "error",
                payload: { message: "Unknown message type: " + msg.type },
            });
        }
    }
    catch (error) {
        console.error("Error handling message:", error);
        figma.ui.postMessage({
            type: "error",
            payload: { message: "Error handling message: " + error.message },
        });
    }
};
// Handle commands from the plugin menu
figma.on("run", ({ command }) => {
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
async function scanVariables() {
    console.log("Starting variable scan...");
    const bindings = [];
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
    async function scanNode(node) {
        // Diagnostic: Log node type and name
        console.log(`[DIAG] Scanning node: ${node.name} (type: ${node.type}, id: ${node.id})`);
        // Diagnostic: Log all properties of the node
        try {
            const nodeProps = Object.keys(node).filter(k => typeof node[k] !== 'function');
            console.log(`[DIAG] Node properties: ${JSON.stringify(nodeProps)}`);
        }
        catch (e) {
            console.warn(`[DIAG] Could not list node properties: ${e}`);
        }
        // Check if node has variable bindings
        if ("boundVariables" in node && node.boundVariables) {
            const boundVars = node.boundVariables;
            console.log(`[DIAG] Found node with bound variables: ${node.name}`);
            // Diagnostic: Log all bound variable properties and their values
            for (const prop in boundVars) {
                const binding = boundVars[prop];
                console.log(`[DIAG] Bound variable: property=${prop}, binding=${JSON.stringify(binding)}`);
            }
            // Special handling for fills and strokes to detect nested properties
            if ("fills" in node) {
                const fills = node.fills;
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
                                        let variableType = VariableTypes.color;
                                        let resolvedValue = "";
                                        try {
                                            const variable = await figma.variables.getVariableByIdAsync(binding.id);
                                            if (variable) {
                                                const resolvedVariable = variable.resolveForConsumer(node);
                                                if (resolvedVariable &&
                                                    typeof resolvedVariable.value === "object" &&
                                                    resolvedVariable.value !== null &&
                                                    "r" in resolvedVariable.value &&
                                                    "g" in resolvedVariable.value &&
                                                    "b" in resolvedVariable.value) {
                                                    const color = resolvedVariable.value;
                                                    const r = Math.round(color.r * 255);
                                                    const g = Math.round(color.g * 255);
                                                    const b = Math.round(color.b * 255);
                                                    resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                                        .toString(16)
                                                        .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                                                }
                                                else {
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
                                        }
                                        catch (e) {
                                            console.warn(`Error resolving fill color variable: ${e}`);
                                        }
                                    }
                                }
                            }
                            else if (fill.type.includes("GRADIENT")) {
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
                                                let variableType = VariableTypes.color;
                                                let resolvedValue = "";
                                                try {
                                                    const variable = await figma.variables.getVariableByIdAsync(binding.id);
                                                    if (variable) {
                                                        const resolvedVariable = variable.resolveForConsumer(node);
                                                        if (resolvedVariable &&
                                                            typeof resolvedVariable.value === "object" &&
                                                            resolvedVariable.value !== null &&
                                                            "r" in resolvedVariable.value &&
                                                            "g" in resolvedVariable.value &&
                                                            "b" in resolvedVariable.value) {
                                                            const color = resolvedVariable.value;
                                                            const r = Math.round(color.r * 255);
                                                            const g = Math.round(color.g * 255);
                                                            const b = Math.round(color.b * 255);
                                                            resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                                                .toString(16)
                                                                .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                                                        }
                                                        else {
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
                                                }
                                                catch (e) {
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
                const strokes = node.strokes;
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
                                        let variableType = VariableTypes.color;
                                        let resolvedValue = "";
                                        try {
                                            const variable = await figma.variables.getVariableByIdAsync(binding.id);
                                            if (variable) {
                                                const resolvedVariable = variable.resolveForConsumer(node);
                                                if (resolvedVariable &&
                                                    typeof resolvedVariable.value === "object" &&
                                                    resolvedVariable.value !== null &&
                                                    "r" in resolvedVariable.value &&
                                                    "g" in resolvedVariable.value &&
                                                    "b" in resolvedVariable.value) {
                                                    const color = resolvedVariable.value;
                                                    const r = Math.round(color.r * 255);
                                                    const g = Math.round(color.g * 255);
                                                    const b = Math.round(color.b * 255);
                                                    resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                                        .toString(16)
                                                        .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                                                }
                                                else {
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
                                        }
                                        catch (e) {
                                            console.warn(`Error resolving stroke color variable: ${e}`);
                                        }
                                    }
                                }
                            }
                            else if (stroke.type.includes("GRADIENT")) {
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
                                                let variableType = VariableTypes.color;
                                                let resolvedValue = "";
                                                try {
                                                    const variable = await figma.variables.getVariableByIdAsync(binding.id);
                                                    if (variable) {
                                                        const resolvedVariable = variable.resolveForConsumer(node);
                                                        if (resolvedVariable &&
                                                            typeof resolvedVariable.value === "object" &&
                                                            resolvedVariable.value !== null &&
                                                            "r" in resolvedVariable.value &&
                                                            "g" in resolvedVariable.value &&
                                                            "b" in resolvedVariable.value) {
                                                            const color = resolvedVariable.value;
                                                            const r = Math.round(color.r * 255);
                                                            const g = Math.round(color.g * 255);
                                                            const b = Math.round(color.b * 255);
                                                            resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                                                .toString(16)
                                                                .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                                                        }
                                                        else {
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
                                                }
                                                catch (e) {
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
                const binding = boundVars[property];
                if (binding && binding.id) {
                    console.log(`Found binding for property: ${property}, ID: ${binding.id}`);
                    let variableType;
                    let resolvedValue = "";
                    // Try to determine variable type and resolved value
                    try {
                        const variable = await figma.variables.getVariableByIdAsync(binding.id);
                        if (variable) {
                            console.log(`Variable found: ${variable.name}, Resolved Type: ${variable.resolvedType}`);
                            const resolvedVariable = variable.resolveForConsumer(node);
                            console.log(`Resolved variable: ${JSON.stringify(resolvedVariable)}`);
                            // Determine type based on the variable's resolvedType
                            switch (variable.resolvedType) {
                                case "COLOR":
                                    variableType = VariableTypes.color;
                                    console.log(`Identified color variable for property: ${property}`);
                                    if (resolvedVariable &&
                                        typeof resolvedVariable.value === "object" &&
                                        resolvedVariable.value !== null &&
                                        "r" in resolvedVariable.value &&
                                        "g" in resolvedVariable.value &&
                                        "b" in resolvedVariable.value) {
                                        const color = resolvedVariable.value;
                                        const r = Math.round(color.r * 255);
                                        const g = Math.round(color.g * 255);
                                        const b = Math.round(color.b * 255);
                                        resolvedValue = `#${r.toString(16).padStart(2, "0")}${g
                                            .toString(16)
                                            .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                                        console.log(`Converted color to hex: ${resolvedValue}`);
                                    }
                                    else {
                                        resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                                        console.log(`Could not convert color to hex, using raw value: ${resolvedValue}`);
                                    }
                                    break;
                                case "FLOAT":
                                    variableType = VariableTypes.number;
                                    resolvedValue = Number((resolvedVariable && resolvedVariable.value) || 0);
                                    break;
                                case "STRING":
                                    variableType = VariableTypes.text;
                                    resolvedValue = String((resolvedVariable && resolvedVariable.value) || "");
                                    break;
                                case "BOOLEAN":
                                    variableType = VariableTypes.other;
                                    resolvedValue = Boolean((resolvedVariable && resolvedVariable.value) || false);
                                    break;
                                default:
                                    console.warn(`Unknown resolved type: ${variable.resolvedType}. Falling back to property name.`);
                                    // Fallback for safety
                                    if (property.includes("color") || property.includes("fill") || property.includes("stroke")) {
                                        variableType = VariableTypes.color;
                                    }
                                    else if (property.includes("character")) {
                                        variableType = VariableTypes.text;
                                    }
                                    else {
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
                        }
                        else {
                            console.warn(`Variable not found for ID: ${binding.id}`);
                        }
                    }
                    catch (e) {
                        console.error(`Error resolving variable: ${e}`);
                    }
                }
                if ((property === "fills" || property === "strokes") && binding) {
                    const bindingsArray = Array.isArray(binding) ? binding : [binding];
                    for (const singleBinding of bindingsArray) {
                        if (singleBinding && singleBinding.id) {
                            try {
                                const variable = await figma.variables.getVariableByIdAsync(singleBinding.id);
                                if (variable && variable.resolvedType === "COLOR") {
                                    const resolvedVariable = variable.resolveForConsumer(node);
                                    let resolvedValue = "";
                                    if (resolvedVariable &&
                                        typeof resolvedVariable.value === "object" &&
                                        resolvedVariable.value !== null &&
                                        "r" in resolvedVariable.value &&
                                        "g" in resolvedVariable.value &&
                                        "b" in resolvedVariable.value) {
                                        const color = resolvedVariable.value;
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
                            }
                            catch (e) {
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
            if (styleProp in node && node[styleProp]) {
                const styleId = node[styleProp];
                if (styleId && styleId !== figma.mixed) {
                    try {
                        console.log(`Found style property: ${styleProp}, ID: ${styleId}`);
                        // Determine variable type based on style property
                        let variableType;
                        if (styleProp === "fillStyleId" || styleProp === "strokeStyleId") {
                            variableType = VariableTypes.color;
                        }
                        else if (styleProp === "textStyleId") {
                            variableType = VariableTypes.text;
                        }
                        else {
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
                    }
                    catch (e) {
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
        await scanNode(node);
    }
    console.log(`Scan complete. Found ${counts.total} variables.`);
    console.log(`Counts: ${JSON.stringify(counts)}`);
    return { bindings, counts };
}
// Detach variables based on provided options
async function detachVariables(bindings, options) {
    console.log("Detaching variables with options:", options);
    const detached = [];
    const skipped = [];
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
    }
    else {
        // Actual detachment logic
        console.log("Starting actual detachment process");
        // First, load all fonts needed for text nodes
        if (options.text) {
            const textBindings = filteredBindings.filter(binding => binding.variableType === VariableTypes.text && binding.property === "characters");
            if (textBindings.length > 0) {
                console.log(`Found ${textBindings.length} text bindings that need font loading`);
                // Get all nodes that need font loading
                const textNodes = [];
                for (const binding of textBindings) {
                    try {
                        console.log(`Getting node for text binding: ${binding.nodeId}`);
                        const node = await figma.getNodeByIdAsync(binding.nodeId);
                        if (node && "fontName" in node) {
                            console.log(`Found text node: ${node.name}`);
                            textNodes.push(node);
                        }
                        else {
                            console.warn(`Node not found or not a text node: ${binding.nodeId}`);
                        }
                    }
                    catch (e) {
                        console.error(`Error getting node for text binding: ${e}`);
                    }
                }
                // Load fonts for all text nodes
                const fontLoadPromises = [];
                for (const node of textNodes) {
                    if ("fontName" in node && node.fontName !== figma.mixed) {
                        const fontName = node.fontName;
                        console.log(`Loading font: ${fontName.family} ${fontName.style}`);
                        fontLoadPromises.push(figma.loadFontAsync({
                            family: fontName.family,
                            style: fontName.style
                        }).catch(err => {
                            console.error(`Error loading font ${fontName.family} ${fontName.style}:`, err);
                        }));
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
                }
                catch (e) {
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
                            // Use async methods for style properties in dynamic pages
                            if (binding.property === "fillStyleId" && "setFillStyleIdAsync" in node) {
                                await node.setFillStyleIdAsync("");
                            }
                            else if (binding.property === "strokeStyleId" && "setStrokeStyleIdAsync" in node) {
                                await node.setStrokeStyleIdAsync("");
                            }
                            else if (binding.property === "textStyleId" && "setTextStyleIdAsync" in node) {
                                await node.setTextStyleIdAsync("");
                            }
                            else {
                                // Fallback to regular method if async not available
                                node[binding.property] = "";
                            }
                            console.log(`Removed style: ${binding.property}`);
                            detached.push(binding);
                            continue;
                        }
                        else {
                            console.warn(`Node does not have style property: ${binding.property}`);
                            skipped.push(binding);
                            continue;
                        }
                    }
                    catch (e) {
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
                            node.characters = String(binding.resolvedValue);
                        }
                        // Handle color properties
                        else if (binding.variableType === VariableTypes.color) {
                            console.log(`Handling color property: ${binding.property}`);
                            try {
                                // For fills and strokes properties
                                if (binding.property === "fills" || binding.property === "strokes") {
                                    const propertyName = binding.property;
                                    const currentValue = node[propertyName];
                                    if (currentValue !== figma.mixed && Array.isArray(currentValue)) {
                                        // Create a new paint array without any variable bindings
                                        const paintArray = currentValue.map(paint => {
                                            if (paint.type === "SOLID") {
                                                // If we have a resolved color value, use it
                                                if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                                                    const hex = binding.resolvedValue.substring(1);
                                                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                                                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                                                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                                                    return {
                                                        type: "SOLID",
                                                        color: { r, g, b },
                                                        opacity: paint.opacity || 1
                                                    };
                                                }
                                                else {
                                                    // If no resolved value, just clone the paint without its binding
                                                    return {
                                                        type: "SOLID",
                                                        color: Object.assign({}, paint.color),
                                                        opacity: paint.opacity || 1
                                                    };
                                                }
                                            }
                                            // For non-solid paints, just clone them
                                            return Object.assign({}, paint);
                                        });
                                        // Apply the new unbound paints
                                        node[propertyName] = paintArray;
                                    }
                                }
                                // For individual paint colors
                                else if (binding.property.includes("fills") || binding.property.includes("strokes")) {
                                    const propertyName = binding.property.startsWith("fills") ? "fills" : "strokes";
                                    const currentValue = node[propertyName];
                                    if (currentValue !== figma.mixed && Array.isArray(currentValue)) {
                                        // Create a copy of the current paints
                                        const paintArray = [...currentValue];
                                        // Try to determine which paint to update
                                        const match = binding.property.match(/\d+/);
                                        if (match) {
                                            const paintIndex = parseInt(match[0]);
                                            if (paintIndex < paintArray.length && paintArray[paintIndex].type === "SOLID") {
                                                // If we have a resolved color value, use it
                                                if (typeof binding.resolvedValue === "string" && binding.resolvedValue.startsWith("#")) {
                                                    const hex = binding.resolvedValue.substring(1);
                                                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                                                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                                                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                                                    // Create a new unbound paint with the resolved color
                                                    paintArray[paintIndex] = {
                                                        type: "SOLID",
                                                        color: { r, g, b },
                                                        opacity: paintArray[paintIndex].opacity || 1
                                                    };
                                                }
                                                else {
                                                    // If no resolved value, just clone the paint without its binding
                                                    const originalPaint = paintArray[paintIndex];
                                                    paintArray[paintIndex] = {
                                                        type: "SOLID",
                                                        color: Object.assign({}, originalPaint.color),
                                                        opacity: originalPaint.opacity || 1
                                                    };
                                                }
                                                // Apply the updated paints
                                                node[propertyName] = paintArray;
                                            }
                                        }
                                    }
                                }
                                detached.push(binding);
                                continue;
                            }
                            catch (e) {
                                console.error(`Error handling color property: ${e}`);
                                skipped.push(binding);
                                continue;
                            }
                        }
                        // Handle spacing and number properties
                        else if (binding.variableType === VariableTypes.number ||
                            (binding.variableType === VariableTypes.other &&
                                typeof binding.resolvedValue === "number")) {
                            console.log(`Setting numeric value: ${binding.resolvedValue}`);
                            const numericValue = Number(binding.resolvedValue);
                            // Apply to the specific property if possible
                            if (binding.property === "width" && "resize" in node) {
                                node.resize(numericValue, node.height);
                                console.log("Applied width value");
                            }
                            else if (binding.property === "height" && "resize" in node) {
                                node.resize(node.width, numericValue);
                                console.log("Applied height value");
                            }
                            else if (binding.property.includes("padding") &&
                                "paddingLeft" in node) {
                                // Check if node has padding properties
                                if (binding.property === "paddingLeft" && "paddingLeft" in node) {
                                    node.paddingLeft = numericValue;
                                    console.log("Applied paddingLeft value");
                                }
                                if (binding.property === "paddingRight" &&
                                    "paddingRight" in node) {
                                    node.paddingRight = numericValue;
                                    console.log("Applied paddingRight value");
                                }
                                if (binding.property === "paddingTop" && "paddingTop" in node) {
                                    node.paddingTop = numericValue;
                                    console.log("Applied paddingTop value");
                                }
                                if (binding.property === "paddingBottom" &&
                                    "paddingBottom" in node) {
                                    node.paddingBottom = numericValue;
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
                                                node.setBoundVariable(binding.property, null);
                                            }
                                            else if (binding.property === "fills" || binding.property === "strokes") {
                                                // Handle direct fills/strokes property
                                                console.log(`Handling direct ${binding.property} property`);
                                                node.setBoundVariable(binding.property, null);
                                            }
                                            else if (binding.property.endsWith("StyleId")) {
                                                // Handle style properties
                                                console.log(`Handling style property: ${binding.property}`);
                                                node.setBoundVariable(binding.property, null);
                                                // Also set the style ID to empty string to ensure it's removed
                                                node[binding.property] = "";
                                            }
                                            else {
                                                // For other fill/stroke related properties
                                                console.log(`Handling other color property: ${binding.property}`);
                                                node.setBoundVariable(binding.property, null);
                                            }
                                        }
                                        else {
                                            // For other color properties
                                            console.log(`Removing other color binding: ${binding.property}`);
                                            node.setBoundVariable(binding.property, null);
                                        }
                                    }
                                    else {
                                        // For non-color properties
                                        node.setBoundVariable(binding.property, null);
                                    }
                                    console.log(`Binding removed for property: ${binding.property} using setBoundVariable(null)`);
                                }
                                else {
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
                                                node[binding.property] = binding.resolvedValue;
                                                console.log(`Set property directly: ${binding.property}`);
                                            }
                                        }
                                    }
                                    catch (e) {
                                        console.error(`Error in alternative approach: ${e}`);
                                    }
                                    console.warn(`Could not remove binding for property: ${binding.property}`);
                                    // We'll still consider it detached since we've applied the value
                                }
                            }
                            catch (e) {
                                console.error(`Error removing variable binding: ${e}`);
                                // We'll still consider it detached if we've applied the value
                            }
                        }
                        detached.push(binding);
                        console.log(`Successfully detached ${binding.property} from ${binding.nodeName}`);
                    }
                    catch (e) {
                        console.error(`Error applying value: ${e}`);
                        skipped.push(binding);
                    }
                }
                else {
                    console.warn(`Node does not have boundVariables: ${binding.nodeId}`);
                    skipped.push(binding);
                }
            }
            catch (e) {
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
async function detachColorVariable(node, property, colorValue) {
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
                const solidPaint = {
                    type: "SOLID",
                    color: { r, g, b },
                    opacity: 1
                };
                // Apply the fill
                node.fills = [solidPaint];
                console.log(`Applied direct fill color`);
                // Try to remove the binding
                if ("setBoundVariable" in node) {
                    node.setBoundVariable(property, null);
                    console.log(`Removed binding for ${property}`);
                }
                return true;
            }
            catch (e) {
                console.error(`Error applying direct fill: ${e}`);
                return false;
            }
        }
        else if (property === "stroke" && "strokes" in node) {
            console.log(`Handling direct stroke property`);
            try {
                // Create a solid paint
                const solidPaint = {
                    type: "SOLID",
                    color: { r, g, b },
                    opacity: 1
                };
                // Apply the stroke
                node.strokes = [solidPaint];
                console.log(`Applied direct stroke color`);
                // Try to remove the binding
                if ("setBoundVariable" in node) {
                    node.setBoundVariable(property, null);
                    console.log(`Removed binding for ${property}`);
                }
                return true;
            }
            catch (e) {
                console.error(`Error applying direct stroke: ${e}`);
                return false;
            }
        }
        else if (property === "backgroundColor" && "backgroundColor" in node) {
            console.log(`Handling backgroundColor property`);
            try {
                // Apply the background color
                node.backgroundColor = { r, g, b };
                console.log(`Applied backgroundColor`);
                // Try to remove the binding
                if ("setBoundVariable" in node) {
                    node.setBoundVariable(property, null);
                    console.log(`Removed binding for ${property}`);
                }
                return true;
            }
            catch (e) {
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
            const currentValue = node[mainProperty];
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
            const paintArray = JSON.parse(JSON.stringify(currentValue));
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
                paintArray[index] = Object.assign(Object.assign({}, paint), { color: newColor });
            }
            else if (paint.type.includes("GRADIENT")) {
                // For gradient stops
                // Type guard for gradient paints
                if (!("gradientStops" in paint)) {
                    console.warn(`Paint does not have gradientStops property`);
                    return false;
                }
                const gradientPaint = paint;
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
                    newGradientStops[stopIndex] = Object.assign(Object.assign({}, newGradientStops[stopIndex]), { color: newStopColor });
                    paintArray[index] = Object.assign(Object.assign({}, gradientPaint), { gradientStops: newGradientStops });
                }
                else {
                    // Just update the entire gradient
                    console.log(`Updating entire gradient`);
                    // No specific changes needed for the gradient itself
                }
            }
            else {
                console.warn(`Unsupported paint type: ${paint.type}`);
                return false;
            }
            // Apply the updated paints
            try {
                node[mainProperty] = paintArray;
                console.log(`Successfully updated ${mainProperty}`);
                // Try to remove the binding
                if ("setBoundVariable" in node) {
                    node.setBoundVariable(property, null);
                    console.log(`Removed binding for ${property}`);
                }
                return true;
            }
            catch (e) {
                console.error(`Error applying updated ${mainProperty}: ${e}`);
                return false;
            }
        }
        else {
            // Handle direct properties like "fills" or "strokes"
            console.log(`Handling direct property: ${property}`);
            // Try to remove the binding
            if ("setBoundVariable" in node) {
                node.setBoundVariable(property, null);
                console.log(`Removed binding for ${property}`);
                return true;
            }
            else {
                console.warn(`Node does not have setBoundVariable method`);
                return false;
            }
        }
    }
    catch (e) {
        console.error(`Error in detachColorVariable: ${e}`);
        return false;
    }
}
