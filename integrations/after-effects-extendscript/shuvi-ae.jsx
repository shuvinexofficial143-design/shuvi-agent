/*
 * Shuvi After Effects ExtendScript adapter.
 *
 * Source-side only until a Windows + After Effects runtime attests it.
 * Designed for afterfx.exe -r wrappers now, with a transport-neutral JSON contract
 * so a future UXP adapter can preserve the same command semantics.
 */
(function (root) {
    var MAX_ITEMS = 512;
    var MAX_LAYERS = 512;
    var MAX_PATH = 12;
    var MAX_SAMPLES = 10000;
    var EPSILON = 0.0001;

    function fail(message) { throw new Error(String(message)); }
    function finiteNumber(v) { return typeof v === "number" && isFinite(v); }
    function boundedString(v, max, label) {
        if (typeof v !== "string" || v.length === 0 || v.length > max) fail("Invalid " + label + ".");
        return v;
    }
    function cloneValue(value, depth) {
        depth = depth || 0;
        if (depth > 8) fail("After Effects value exceeds serialization depth.");
        if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
        if (value instanceof Array) {
            if (value.length > 64) fail("After Effects value array exceeds bound.");
            var out = [], i;
            for (i = 0; i < value.length; i++) out.push(cloneValue(value[i], depth + 1));
            return out;
        }
        return String(value);
    }
    function sameValue(a, b) {
        if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPSILON;
        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return false;
            var i;
            for (i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
            return true;
        }
        return a === b;
    }
    function requireProject() {
        if (!app.project) fail("No After Effects project is open.");
        return app.project;
    }
    function resolveComp(compId) {
        if (!finiteNumber(compId) || compId <= 0 || Math.floor(compId) !== compId) fail("Exact positive comp_id required.");
        var project = requireProject();
        var item = project.itemByID(compId);
        if (!item || !(item instanceof CompItem) || item.id !== compId) fail("Target composition ID is stale or unavailable.");
        return item;
    }
    function resolveItem(itemId) {
        if (!finiteNumber(itemId) || itemId <= 0 || Math.floor(itemId) !== itemId) fail("Exact positive item_id required.");
        var item = requireProject().itemByID(itemId);
        if (!item || item.id !== itemId) fail("Target project item ID is stale or unavailable.");
        return item;
    }
    function findLayerById(comp, layerId) {
        if (!finiteNumber(layerId) || layerId <= 0 || Math.floor(layerId) !== layerId) return null;
        var limit = Math.min(comp.numLayers, MAX_LAYERS);
        var found = null, i;
        for (i = 1; i <= limit; i++) {
            var layer = comp.layer(i);
            if (layer && layer.id === layerId) {
                if (found) fail("Layer ID resolved ambiguously inside target composition.");
                found = layer;
            }
        }
        return found;
    }
    function resolveLayer(comp, layerId) {
        var found = findLayerById(comp, layerId);
        if (!found) fail("Target layer ID is stale or outside the target composition.");
        return found;
    }
    function resolveProperty(target) {
        if (!target || !target.target || !(target.path instanceof Array) || target.path.length < 1 || target.path.length > MAX_PATH) {
            fail("Bounded property target required.");
        }
        var comp = resolveComp(target.target.comp_id);
        var layer = resolveLayer(comp, target.target.layer_id);
        var current = layer, i;
        for (i = 0; i < target.path.length; i++) {
            var segment = target.path[i];
            var matchName = boundedString(segment.match_name, 160, "property match_name");
            var next = current.property(matchName);
            if (!next || next.matchName !== matchName) fail("Property path matchName is stale or unavailable.");
            if (segment.property_index !== null && segment.property_index !== undefined) {
                if (!finiteNumber(segment.property_index) || segment.property_index <= 0 || Math.floor(segment.property_index) !== segment.property_index) {
                    fail("Invalid property_index stale guard.");
                }
                if (next.propertyIndex !== segment.property_index) fail("Property index stale guard changed.");
            }
            current = next;
        }
        return { comp: comp, layer: layer, property: current };
    }
    function propertySnapshot(target) {
        var resolved = resolveProperty(target);
        var p = resolved.property;
        var snapshot = {
            comp_id: resolved.comp.id,
            layer_id: resolved.layer.id,
            layer_index: resolved.layer.index,
            property_match_name: p.matchName,
            property_index: p.propertyIndex,
            property_type: String(p.propertyType),
            value_type: p.propertyValueType === undefined ? null : String(p.propertyValueType),
            num_keys: p.numKeys === undefined ? null : p.numKeys,
            can_vary_over_time: p.canVaryOverTime === undefined ? null : !!p.canVaryOverTime,
            expression_enabled: p.expressionEnabled === undefined ? null : !!p.expressionEnabled
        };
        if (p.value !== undefined) snapshot.value = cloneValue(p.value);
        return snapshot;
    }
    function inspectContext() {
        var project = requireProject();
        var comps = [], i, item;
        var limit = Math.min(project.numItems, MAX_ITEMS);
        for (i = 1; i <= limit; i++) {
            item = project.item(i);
            if (item instanceof CompItem) {
                comps.push({
                    id: item.id,
                    name: String(item.name).slice(0, 240),
                    width: item.width,
                    height: item.height,
                    duration: item.duration,
                    frame_rate: item.frameRate,
                    num_layers: item.numLayers
                });
            }
        }
        var active = project.activeItem;
        return {
            verification_status: "verified_readback",
            ae_version: String(app.version),
            project_file: project.file ? project.file.fsName : null,
            item_count: project.numItems,
            item_scan_truncated: project.numItems > MAX_ITEMS,
            active_comp_id: active && active instanceof CompItem ? active.id : null,
            compositions: comps
        };
    }
    function inspectComp(args) {
        var comp = resolveComp(args.comp_id);
        var layers = [], i, limit = Math.min(comp.numLayers, MAX_LAYERS);
        for (i = 1; i <= limit; i++) {
            var layer = comp.layer(i);
            layers.push({
                id: layer.id,
                index: layer.index,
                name: String(layer.name).slice(0, 240),
                enabled: !!layer.enabled,
                locked: !!layer.locked,
                shy: !!layer.shy,
                in_point: layer.inPoint,
                out_point: layer.outPoint,
                start_time: layer.startTime,
                stretch: layer.stretch
            });
        }
        return {
            verification_status: "verified_readback",
            comp_id: comp.id,
            name: String(comp.name).slice(0, 240),
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frame_rate: comp.frameRate,
            num_layers: comp.numLayers,
            layer_scan_truncated: comp.numLayers > MAX_LAYERS,
            layers: layers
        };
    }
    function inspectProperty(args) {
        var snapshot = propertySnapshot(args.property);
        snapshot.verification_status = "verified_readback";
        return snapshot;
    }
    function setProperty(args) {
        var before = propertySnapshot(args.property);
        var resolved = resolveProperty(args.property);
        var p = resolved.property;
        if (p.numKeys !== undefined && p.numKeys > 0) fail("Static set refused because property already has keyframes.");
        if (p.setValue === undefined) fail("Target is not a writable AE Property.");
        var requested = cloneValue(args.value);
        app.beginUndoGroup("Shuvi: Set property");
        try { p.setValue(requested); } finally { app.endUndoGroup(); }
        var after = propertySnapshot(args.property);
        var verified = sameValue(after.value, requested);
        return {
            native_accepted: true,
            verification_status: verified ? "verified_readback" : "accepted_unverified",
            retry_safe: verified,
            before: before,
            after: after,
            requested_value: requested
        };
    }
    function validateTimesValues(times, values) {
        if (!(times instanceof Array) || !(values instanceof Array) || times.length === 0 || times.length !== values.length || times.length > MAX_SAMPLES) {
            fail("Keyframe times/values must be equal bounded arrays.");
        }
        var previous = -1, i;
        for (i = 0; i < times.length; i++) {
            if (!finiteNumber(times[i]) || times[i] < 0 || times[i] > 10800 || times[i] <= previous) fail("Keyframe times must be finite strictly increasing composition seconds.");
            cloneValue(values[i]);
            previous = times[i];
        }
    }
    function setValuesAtTimes(args) {
        validateTimesValues(args.times, args.values);
        var before = propertySnapshot(args.property);
        var resolved = resolveProperty(args.property);
        var p = resolved.property;
        if (!p.canVaryOverTime || p.setValuesAtTimes === undefined) fail("Target property cannot accept temporal keyframes.");
        var times = args.times.slice(0), values = [], i;
        for (i = 0; i < args.values.length; i++) values.push(cloneValue(args.values[i]));
        app.beginUndoGroup("Shuvi: Apply tracked keyframes");
        try { p.setValuesAtTimes(times, values); } finally { app.endUndoGroup(); }

        var readback = [], verified = true;
        for (i = 0; i < times.length; i++) {
            var v = cloneValue(p.valueAtTime(times[i], true));
            readback.push(v);
            if (!sameValue(v, values[i])) verified = false;
        }
        var after = propertySnapshot(args.property);
        return {
            native_accepted: true,
            verification_status: verified ? "verified_keyframe_readback" : "accepted_unverified",
            retry_safe: verified,
            comp_id: resolved.comp.id,
            layer_id: resolved.layer.id,
            sample_count: times.length,
            before_num_keys: before.num_keys,
            after_num_keys: after.num_keys,
            readback_values: readback
        };
    }
    function effectInventory(layer) {
        var parade=layer.property("ADBE Effect Parade");
        if(!parade)return [];
        if(parade.numProperties>256)fail("Effect inventory exceeds 256-item safety bound.");
        var out=[],i;
        for(i=1;i<=parade.numProperties;i++){
            var effect=parade.property(i);
            out.push({match_name:String(effect.matchName),name:String(effect.name)});
        }
        return out;
    }
    function sameEffectInventory(actual,expected) {
        if(actual.length!==expected.length)return false;
        var i;for(i=0;i<actual.length;i++)if(actual[i].match_name!==expected[i].match_name||actual[i].name!==expected[i].name)return false;
        return true;
    }
    function addEffect(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        var matchName = boundedString(args.effect_match_name, 160, "effect matchName");
        var parade = layer.property("ADBE Effect Parade");
        if (!parade || !parade.canAddProperty(matchName)) fail("Effect cannot be added by this documented matchName.");
        var beforeCount = parade.numProperties;
        app.beginUndoGroup("Shuvi: Add effect");
        var addedIndex = null;
        try {
            var added = parade.addProperty(matchName);
            if (!added) fail("After Effects returned no added effect.");
            addedIndex = added.propertyIndex;
        } finally { app.endUndoGroup(); }

        parade = layer.property("ADBE Effect Parade");
        var afterCount = parade.numProperties;
        var readback = addedIndex ? parade.property(addedIndex) : null;
        var verified = afterCount === beforeCount + 1 && !!readback && readback.matchName === matchName;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_delta" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            layer_id: layer.id,
            effect_match_name: matchName,
            effect_property_index: addedIndex,
            before_count: beforeCount,
            after_count: afterCount
        };
    }
    function removeEffect(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        var parade=layer.property("ADBE Effect Parade");
        if(!parade)fail("Target layer has no effect parade.");
        var index=args.effect_property_index,expectedMatch=boundedString(args.expected_match_name,160,"expected effect matchName");
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>parade.numProperties)fail("Invalid effect_property_index.");
        var target=parade.property(index);
        if(!target||!target.isEffect||String(target.matchName)!==expectedMatch)fail("Effect stale guard changed.");
        var before=effectInventory(layer),expectedAfter=[],i;
        for(i=0;i<before.length;i++)if(i!==index-1)expectedAfter.push(before[i]);
        app.beginUndoGroup("Shuvi: Remove effect");
        try{target.remove();}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after=effectInventory(layer);
        var verified=after.length===before.length-1&&sameEffectInventory(after,expectedAfter);
        return {native_accepted:true,verification_status:verified?"verified_effect_delta":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer.id,removed_property_index:index,removed_match_name:expectedMatch,
            before_effects:before,after_effects:after};
    }
    function addNull(args) {
        var comp = resolveComp(args.comp_id);
        var before = comp.numLayers;
        var name = args.name === undefined ? "Shuvi Track" : boundedString(args.name, 120, "null name");
        app.beginUndoGroup("Shuvi: Add tracking null");
        var layer;
        try {
            layer = comp.layers.addNull();
            layer.name = name;
        } finally { app.endUndoGroup(); }
        var verified = comp.numLayers === before + 1 && layer && layer.id > 0 && resolveLayer(comp, layer.id).id === layer.id;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_delta" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            layer_id: layer ? layer.id : null,
            layer_index: layer ? layer.index : null,
            before_count: before,
            after_count: comp.numLayers
        };
    }
    function addText(args) {
        var comp = resolveComp(args.comp_id);
        var text = args.text === undefined ? "" : String(args.text);
        if (text.length > 16384) fail("Text layer content exceeds 16 KiB.");
        var name = args.name === undefined ? null : boundedString(args.name, 120, "text layer name");
        var before = comp.numLayers;
        app.beginUndoGroup("Shuvi: Add text layer");
        var layer;
        try {
            layer = comp.layers.addText(text);
            if (name) layer.name = name;
        } finally { app.endUndoGroup(); }
        var source = layer ? layer.property("ADBE Text Properties").property("ADBE Text Document") : null;
        var readText = source && source.value ? String(source.value.text) : null;
        var verified = comp.numLayers === before + 1 && layer && layer.id > 0
            && resolveLayer(comp, layer.id).id === layer.id && readText === text;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_creation_readback" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            layer_id: layer ? layer.id : null,
            layer_index: layer ? layer.index : null,
            source_text: readText,
            before_count: before,
            after_count: comp.numLayers
        };
    }
    function setExpression(args) {
        var expression = args.expression;
        if (typeof expression !== "string" || expression.length > 65535) fail("Expression must be a bounded string.");
        var before = propertySnapshot(args.property);
        var resolved = resolveProperty(args.property);
        var p = resolved.property;
        if (!p.canSetExpression) fail("Target property cannot accept expressions.");
        app.beginUndoGroup("Shuvi: Set expression");
        try { p.expression = expression; } finally { app.endUndoGroup(); }
        var afterResolved = resolveProperty(args.property);
        var afterP = afterResolved.property;
        var errorText = String(afterP.expressionError || "");
        var verified = String(afterP.expression) === expression && errorText === ""
            && (expression.length > 0 ? !!afterP.expressionEnabled : !afterP.expressionEnabled);
        return {
            native_accepted: true,
            verification_status: verified ? "verified_expression_readback" : "accepted_unverified",
            retry_safe: verified,
            before: before,
            after: propertySnapshot(args.property),
            expression_error: errorText
        };
    }
    function setLayerParent(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        var parent = args.parent_layer_id === null || args.parent_layer_id === undefined ? null : resolveLayer(comp, args.parent_layer_id);
        if (parent && parent.id === layer.id) fail("Layer cannot parent itself.");
        var preserveVisual = args.preserve_visual !== false;
        var beforeParent = layer.parent ? layer.parent.id : null;
        app.beginUndoGroup("Shuvi: Set layer parent");
        try {
            if (preserveVisual) layer.parent = parent;
            else if (parent) layer.setParentWithJump(parent);
            else layer.setParentWithJump();
        } finally { app.endUndoGroup(); }
        layer = resolveLayer(comp, args.layer_id);
        var afterParent = layer.parent ? layer.parent.id : null;
        var requestedParent = parent ? parent.id : null;
        var verified = afterParent === requestedParent;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_readback" : "accepted_unverified",
            retry_safe: verified,
            comp_id: comp.id,
            layer_id: layer.id,
            before_parent_layer_id: beforeParent,
            after_parent_layer_id: afterParent,
            preserve_visual: preserveVisual
        };
    }
    function duplicateLayer(args) {
        var comp = resolveComp(args.comp_id);
        var source = resolveLayer(comp, args.layer_id);
        var before = comp.numLayers;
        var sourceName = String(source.name);
        app.beginUndoGroup("Shuvi: Duplicate layer");
        var copy;
        try { copy = source.duplicate(); } finally { app.endUndoGroup(); }
        var verified = comp.numLayers === before + 1 && copy && copy.id > 0 && copy.id !== source.id
            && String(resolveLayer(comp, copy.id).name) === sourceName;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_creation_identity" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            source_layer_id: source.id,
            created_layer_id: copy ? copy.id : null,
            semantic_copy_verified: false,
            before_count: before,
            after_count: comp.numLayers
        };
    }
    function removeLayer(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        var before = comp.numLayers;
        var id = layer.id;
        app.beginUndoGroup("Shuvi: Remove layer");
        try { layer.remove(); } finally { app.endUndoGroup(); }
        var verified = comp.numLayers === before - 1 && findLayerById(comp, id) === null;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_delta" : "accepted_unverified",
            retry_safe: verified,
            comp_id: comp.id,
            removed_layer_id: id,
            before_count: before,
            after_count: comp.numLayers
        };
    }
    function precomposeLayers(args) {
        var comp = resolveComp(args.comp_id);
        if (!(args.layer_ids instanceof Array) || args.layer_ids.length < 1 || args.layer_ids.length > 64) fail("Precompose requires 1..64 exact layer IDs.");
        if (args.move_all_attributes !== true) fail("Shuvi currently supports only move_all_attributes=true for verifiable precompose.");
        var seen = {}, indices = [], ids = [], i;
        for (i = 0; i < args.layer_ids.length; i++) {
            var layer = resolveLayer(comp, args.layer_ids[i]);
            if (seen[layer.id]) fail("Duplicate layer ID in precompose request.");
            seen[layer.id] = true; ids.push(layer.id); indices.push(layer.index);
        }
        var name = boundedString(args.name, 120, "precompose name");
        var beforeLayers = comp.numLayers;
        var beforeItems = requireProject().numItems;
        app.beginUndoGroup("Shuvi: Precompose layers");
        var created;
        try { created = comp.layers.precompose(indices, name, true); } finally { app.endUndoGroup(); }
        if (!created || !(created instanceof CompItem)) fail("After Effects returned no precomposition.");
        var allInside = true, allGone = true;
        for (i = 0; i < ids.length; i++) {
            if (!findLayerById(created, ids[i])) allInside = false;
            if (findLayerById(comp, ids[i])) allGone = false;
        }
        var sourceLayer = null;
        for (i = 1; i <= Math.min(comp.numLayers, MAX_LAYERS); i++) {
            var candidate = comp.layer(i);
            if (candidate.source && candidate.source.id === created.id) { sourceLayer = candidate; break; }
        }
        var verified = requireProject().numItems === beforeItems + 1 && allInside && allGone && !!sourceLayer;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_precompose_semantics" : "accepted_unverified",
            retry_safe: false,
            source_comp_id: comp.id,
            created_comp_id: created.id,
            created_layer_id: sourceLayer ? sourceLayer.id : null,
            moved_layer_ids: ids,
            source_before_layers: beforeLayers,
            source_after_layers: comp.numLayers
        };
    }
    function samePointList(a, b) {
        if (!(a instanceof Array) || !(b instanceof Array) || a.length !== b.length) return false;
        var i;
        for (i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
        return true;
    }
    function addMask(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        if (!(args.vertices instanceof Array) || args.vertices.length < 3 || args.vertices.length > 512) fail("Mask requires 3..512 vertices.");
        var vertices = [], inTangents = [], outTangents = [], i;
        for (i = 0; i < args.vertices.length; i++) {
            var v = args.vertices[i];
            if (!(v instanceof Array) || v.length !== 2 || !finiteNumber(v[0]) || !finiteNumber(v[1])) fail("Mask vertices must be finite [x,y] pairs.");
            vertices.push([v[0], v[1]]);
            inTangents.push([0,0]); outTangents.push([0,0]);
        }
        if (args.in_tangents !== undefined) {
            if (!(args.in_tangents instanceof Array) || args.in_tangents.length !== vertices.length) fail("Mask in_tangents length mismatch.");
            inTangents = args.in_tangents;
        }
        if (args.out_tangents !== undefined) {
            if (!(args.out_tangents instanceof Array) || args.out_tangents.length !== vertices.length) fail("Mask out_tangents length mismatch.");
            outTangents = args.out_tangents;
        }
        for (i = 0; i < vertices.length; i++) {
            if (!(inTangents[i] instanceof Array) || inTangents[i].length !== 2 || !(outTangents[i] instanceof Array) || outTangents[i].length !== 2
                || !finiteNumber(inTangents[i][0]) || !finiteNumber(inTangents[i][1]) || !finiteNumber(outTangents[i][0]) || !finiteNumber(outTangents[i][1])) {
                fail("Mask tangents must be finite [x,y] pairs.");
            }
        }
        var masks = layer.property("ADBE Mask Parade");
        if (!masks || !masks.canAddProperty("ADBE Mask Atom")) fail("Target layer cannot accept masks.");
        var before = masks.numProperties;
        app.beginUndoGroup("Shuvi: Add mask");
        var maskIndex;
        try {
            var mask = masks.addProperty("ADBE Mask Atom");
            maskIndex = mask.propertyIndex;
            var shape = new Shape();
            shape.vertices = vertices;
            shape.inTangents = inTangents;
            shape.outTangents = outTangents;
            shape.closed = args.closed !== false;
            mask.property("ADBE Mask Shape").setValue(shape);
        } finally { app.endUndoGroup(); }
        masks = resolveLayer(comp, args.layer_id).property("ADBE Mask Parade");
        var readMask = masks.property(maskIndex);
        var readShape = readMask ? readMask.property("ADBE Mask Shape").value : null;
        var verified = masks.numProperties === before + 1 && readShape && samePointList(readShape.vertices, vertices)
            && !!readShape.closed === (args.closed !== false);
        return {
            native_accepted: true,
            verification_status: verified ? "verified_mask_readback" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            layer_id: args.layer_id,
            mask_property_index: maskIndex,
            before_count: before,
            after_count: masks.numProperties,
            vertex_count: vertices.length
        };
    }
    function inspectSceneEdits(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        var times = layer.doSceneEditDetection(SceneEditDetectionMode.NONE);
        if (!(times instanceof Array) || times.length > 10000) fail("Scene detection returned an invalid or oversized result.");
        return {
            verification_status: "verified_host_detection_result",
            comp_id: comp.id,
            layer_id: layer.id,
            edit_count: times.length,
            edit_times: cloneValue(times),
            mutation_applied: false
        };
    }
    function addSceneEditMarkers(args) {
        var comp = resolveComp(args.comp_id);
        var layer = resolveLayer(comp, args.layer_id);
        var detected = layer.doSceneEditDetection(SceneEditDetectionMode.NONE);
        if (!(detected instanceof Array) || detected.length > 10000) fail("Scene detection returned an invalid or oversized result.");
        var marker = layer.marker;
        var beforeTimes = [], i, j;
        for (i = 1; i <= marker.numKeys; i++) beforeTimes.push(marker.keyTime(i));
        for (i = 0; i < detected.length; i++) {
            for (j = 0; j < beforeTimes.length; j++) if (Math.abs(detected[i] - beforeTimes[j]) <= EPSILON) {
                fail("Scene marker write would overlap an existing marker; mutation refused as ambiguous.");
            }
        }
        var before = marker.numKeys;
        app.beginUndoGroup("Shuvi: Scene edit markers");
        var applied;
        try { applied = layer.doSceneEditDetection(SceneEditDetectionMode.MARKERS); } finally { app.endUndoGroup(); }
        layer = resolveLayer(comp, args.layer_id); marker = layer.marker;
        var verified = applied instanceof Array && applied.length === detected.length && marker.numKeys === before + detected.length;
        if (verified) {
            for (i = 0; i < detected.length; i++) {
                var found = false;
                for (j = 1; j <= marker.numKeys; j++) if (Math.abs(marker.keyTime(j) - detected[i]) <= EPSILON) { found = true; break; }
                if (!found) { verified = false; break; }
            }
        }
        return {
            native_accepted: true,
            verification_status: verified ? "verified_marker_delta" : "accepted_unverified",
            retry_safe: false,
            comp_id: comp.id,
            layer_id: layer.id,
            detected_count: detected.length,
            before_marker_count: before,
            after_marker_count: marker.numKeys
        };
    }
    function addShape(args) {
        var comp = resolveComp(args.comp_id), before = comp.numLayers;
        var name = args.name === undefined ? "Shuvi Shape" : boundedString(args.name, 120, "shape name");
        app.beginUndoGroup("Shuvi: Add shape layer");
        var layer;
        try { layer = comp.layers.addShape(); layer.name = name; } finally { app.endUndoGroup(); }
        var verified = comp.numLayers === before + 1 && layer && layer.id > 0 && resolveLayer(comp, layer.id).id === layer.id;
        return {native_accepted:true,verification_status:verified?"verified_creation_identity":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer?layer.id:null,before_count:before,after_count:comp.numLayers};
    }
    function addSolid(args) {
        var comp = resolveComp(args.comp_id), color=args.color;
        if (!(color instanceof Array) || color.length!==3) fail("Solid color must be [r,g,b].");
        var i; for(i=0;i<3;i++) if(!finiteNumber(color[i])||color[i]<0||color[i]>1) fail("Solid color values must be 0..1.");
        var width=args.width, height=args.height, pixel=args.pixel_aspect===undefined?1:args.pixel_aspect;
        if(!finiteNumber(width)||Math.floor(width)!==width||width<4||width>30000
            ||!finiteNumber(height)||Math.floor(height)!==height||height<4||height>30000
            ||!finiteNumber(pixel)||pixel<0.01||pixel>100) fail("Invalid solid dimensions or pixel aspect.");
        var duration=args.duration_seconds===undefined?comp.duration:args.duration_seconds;
        if(!finiteNumber(duration)||duration<=0||duration>10800) fail("Invalid solid duration.");
        var name=args.name===undefined?"Shuvi Solid":boundedString(args.name,120,"solid name");
        var before=comp.numLayers;
        app.beginUndoGroup("Shuvi: Add solid");
        var layer;
        try { layer=comp.layers.addSolid(color,name,width,height,pixel,duration); } finally { app.endUndoGroup(); }
        var read=layer?resolveLayer(comp,layer.id):null;
        var verified=comp.numLayers===before+1&&read&&read.source&&read.source.width===width&&read.source.height===height;
        return {native_accepted:true,verification_status:verified?"verified_creation_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer?layer.id:null,source_item_id:read&&read.source?read.source.id:null,before_count:before,after_count:comp.numLayers};
    }
    function addCamera(args) {
        var comp=resolveComp(args.comp_id), center=args.center_point;
        if(!(center instanceof Array)||center.length!==2||!finiteNumber(center[0])||!finiteNumber(center[1])) fail("Camera center_point must be finite [x,y].");
        var name=args.name===undefined?"Shuvi Camera":boundedString(args.name,120,"camera name");
        var before=comp.numLayers;
        app.beginUndoGroup("Shuvi: Add camera");
        var layer; try{layer=comp.layers.addCamera(name,center);}finally{app.endUndoGroup();}
        var read=layer?resolveLayer(comp,layer.id):null;
        var verified=comp.numLayers===before+1&&read&&read.id===layer.id;
        return {native_accepted:true,verification_status:verified?"verified_creation_identity":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer?layer.id:null,before_count:before,after_count:comp.numLayers};
    }
    function addLight(args) {
        var comp=resolveComp(args.comp_id), center=args.center_point;
        if(!(center instanceof Array)||center.length!==2||!finiteNumber(center[0])||!finiteNumber(center[1])) fail("Light center_point must be finite [x,y].");
        var name=args.name===undefined?"Shuvi Light":boundedString(args.name,120,"light name");
        var before=comp.numLayers;
        app.beginUndoGroup("Shuvi: Add light");
        var layer; try{layer=comp.layers.addLight(name,center);}finally{app.endUndoGroup();}
        var read=layer?resolveLayer(comp,layer.id):null;
        var verified=comp.numLayers===before+1&&read&&read.id===layer.id;
        return {native_accepted:true,verification_status:verified?"verified_creation_identity":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer?layer.id:null,before_count:before,after_count:comp.numLayers};
    }
    function setLayerState(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id);
        var requested={};
        if(args.name!==undefined) requested.name=boundedString(args.name,240,"layer name");
        if(args.enabled!==undefined){if(typeof args.enabled!=="boolean")fail("enabled must be boolean.");requested.enabled=args.enabled;}
        if(args.shy!==undefined){if(typeof args.shy!=="boolean")fail("shy must be boolean.");requested.shy=args.shy;}
        if(args.solo!==undefined){if(typeof args.solo!=="boolean")fail("solo must be boolean.");requested.solo=args.solo;}
        if(args.label!==undefined){if(!finiteNumber(args.label)||Math.floor(args.label)!==args.label||args.label<0||args.label>16)fail("label must be 0..16.");requested.label=args.label;}
        if(args.locked!==undefined){if(typeof args.locked!=="boolean")fail("locked must be boolean.");requested.locked=args.locked;}
        var before={name:String(layer.name),enabled:!!layer.enabled,shy:!!layer.shy,solo:!!layer.solo,label:layer.label,locked:!!layer.locked};
        if(before.locked && requested.locked!==false) fail("Layer is locked; unlock explicitly before changing state.");
        app.beginUndoGroup("Shuvi: Set layer state");
        try{
            if(requested.locked===false) layer.locked=false;
            if(requested.name!==undefined) layer.name=requested.name;
            if(requested.enabled!==undefined) layer.enabled=requested.enabled;
            if(requested.shy!==undefined) layer.shy=requested.shy;
            if(requested.solo!==undefined) layer.solo=requested.solo;
            if(requested.label!==undefined) layer.label=requested.label;
            if(requested.locked===true) layer.locked=true;
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after={name:String(layer.name),enabled:!!layer.enabled,shy:!!layer.shy,solo:!!layer.solo,label:layer.label,locked:!!layer.locked};
        var verified=true,k;for(k in requested)if(requested.hasOwnProperty(k)&&after[k]!==requested[k])verified=false;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before:before,after:after};
    }
    function moveLayer(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id), relation=boundedString(args.relation,24,"layer move relation");
        var target=null;
        if(relation==="before"||relation==="after"){
            target=resolveLayer(comp,args.target_layer_id);
            if(target.id===layer.id)fail("Layer move target cannot be itself.");
        } else if(relation!=="beginning"&&relation!=="end") fail("Layer move relation must be before, after, beginning or end.");
        app.beginUndoGroup("Shuvi: Move layer");
        try{
            if(relation==="before")layer.moveBefore(target);
            else if(relation==="after")layer.moveAfter(target);
            else if(relation==="beginning")layer.moveToBeginning();
            else layer.moveToEnd();
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        if(target)target=resolveLayer(comp,args.target_layer_id);
        var verified=relation==="before"?layer.index<target.index:relation==="after"?layer.index>target.index:
            relation==="beginning"?layer.index===1:layer.index===comp.numLayers;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,relation:relation,layer_index:layer.index,target_layer_id:target?target.id:null,target_index:target?target.index:null};
    }
    function trackMatteEnum(name) {
        if(name==="alpha")return TrackMatteType.ALPHA;
        if(name==="alpha_inverted")return TrackMatteType.ALPHA_INVERTED;
        if(name==="luma")return TrackMatteType.LUMA;
        if(name==="luma_inverted")return TrackMatteType.LUMA_INVERTED;
        fail("Unsupported track matte type.");
    }
    function setTrackMatte(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id), matte=resolveLayer(comp,args.matte_layer_id);
        if(layer.id===matte.id)fail("Track matte layer cannot equal target layer.");
        if(typeof layer.setTrackMatte!=="function")fail("Current After Effects host does not expose setTrackMatte.");
        var type=trackMatteEnum(boundedString(args.matte_type,32,"track matte type"));
        app.beginUndoGroup("Shuvi: Set track matte");
        try{layer.setTrackMatte(matte,type);}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var verified=layer.trackMatteLayer&&layer.trackMatteLayer.id===matte.id&&layer.trackMatteType===type;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,matte_layer_id:matte.id,matte_type:args.matte_type};
    }
    function removeTrackMatte(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id);
        if(typeof layer.removeTrackMatte!=="function")fail("Current After Effects host does not expose removeTrackMatte.");
        app.beginUndoGroup("Shuvi: Remove track matte");
        try{layer.removeTrackMatte();}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var verified=layer.trackMatteLayer===null;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,track_matte_removed:verified};
    }
    function setTimeRemap(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id);
        if(typeof args.enabled!=="boolean")fail("time remap enabled must be boolean.");
        if(!layer.canSetTimeRemapEnabled)fail("Layer cannot change time-remap state.");
        var before=!!layer.timeRemapEnabled;
        app.beginUndoGroup("Shuvi: Set time remap");
        try{layer.timeRemapEnabled=args.enabled;}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after=!!layer.timeRemapEnabled, verified=after===args.enabled;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before:before,after:after};
    }
    function replaceSource(args) {
        var comp=resolveComp(args.comp_id), layer=resolveLayer(comp,args.layer_id), source=resolveItem(args.source_item_id);
        if(typeof layer.replaceSource!=="function")fail("Target layer does not support source replacement.");
        var before=layer.source?layer.source.id:null;
        app.beginUndoGroup("Shuvi: Replace source");
        try{layer.replaceSource(source,args.fix_expressions===true);}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after=layer.source?layer.source.id:null, verified=after===source.id;
        return {native_accepted:true,verification_status:verified?"verified_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before_source_item_id:before,after_source_item_id:after,fix_expressions:args.fix_expressions===true};
    }
    function createComp(args) {
        var name=boundedString(args.name,120,"composition name");
        var width=args.width,height=args.height,pixel=args.pixel_aspect===undefined?1:args.pixel_aspect;
        var duration=args.duration_seconds,rate=args.frame_rate;
        if(!finiteNumber(width)||Math.floor(width)!==width||width<4||width>30000
            ||!finiteNumber(height)||Math.floor(height)!==height||height<4||height>30000
            ||!finiteNumber(pixel)||pixel<0.01||pixel>100
            ||!finiteNumber(duration)||duration<=0||duration>10800
            ||!finiteNumber(rate)||rate<1||rate>99) fail("Invalid composition dimensions, duration or frame rate.");
        var project=requireProject(),before=project.numItems;
        app.beginUndoGroup("Shuvi: Create composition");
        var comp;try{comp=project.items.addComp(name,width,height,pixel,duration,rate);}finally{app.endUndoGroup();}
        var read=comp?project.itemByID(comp.id):null;
        var verified=project.numItems===before+1&&read&&read instanceof CompItem&&read.id===comp.id
            &&read.width===width&&read.height===height&&Math.abs(read.duration-duration)<=EPSILON&&Math.abs(read.frameRate-rate)<=EPSILON;
        return {native_accepted:true,verification_status:verified?"verified_creation_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp?comp.id:null,before_item_count:before,after_item_count:project.numItems};
    }
    function importFootage(args) {
        var path=boundedString(args.file_path,4096,"footage file path"), file=new File(path);
        if(!file.exists)fail("Footage file does not exist.");
        var options=new ImportOptions(file);
        if(!options.canImportAs(ImportAsType.FOOTAGE))fail("File cannot be imported as ordinary footage.");
        options.importAs=ImportAsType.FOOTAGE;
        options.sequence=args.sequence===true;
        var project=requireProject(),before=project.numItems;
        app.beginUndoGroup("Shuvi: Import footage");
        var item;try{item=project.importFile(options);}finally{app.endUndoGroup();}
        var read=item?project.itemByID(item.id):null;
        var actual=read&&read instanceof FootageItem&&read.file?read.file.fsName:null;
        var verified=project.numItems===before+1&&read&&read instanceof FootageItem&&actual===file.fsName;
        return {native_accepted:true,verification_status:verified?"verified_import_identity":"accepted_unverified",retry_safe:false,
            item_id:item?item.id:null,source_file:actual,before_item_count:before,after_item_count:project.numItems};
    }
    function addItemLayer(args) {
        var comp=resolveComp(args.comp_id),item=resolveItem(args.item_id);
        if(!(item instanceof CompItem)&&!(item instanceof FootageItem))fail("Only composition or footage items can be added as AV layers.");
        var before=comp.numLayers;
        app.beginUndoGroup("Shuvi: Add item layer");
        var layer;try{layer=comp.layers.add(item);}finally{app.endUndoGroup();}
        var read=layer?resolveLayer(comp,layer.id):null;
        var verified=comp.numLayers===before+1&&read&&read.source&&read.source.id===item.id;
        return {native_accepted:true,verification_status:verified?"verified_creation_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,item_id:item.id,layer_id:layer?layer.id:null,before_count:before,after_count:comp.numLayers};
    }
    function justificationEnum(name) {
        if(name==="left")return ParagraphJustification.LEFT_JUSTIFY;
        if(name==="right")return ParagraphJustification.RIGHT_JUSTIFY;
        if(name==="center")return ParagraphJustification.CENTER_JUSTIFY;
        fail("Unsupported text justification.");
    }
    function validateColor(value,label) {
        if(!(value instanceof Array)||value.length!==3)fail(label+" must be [r,g,b].");
        var i;for(i=0;i<3;i++)if(!finiteNumber(value[i])||value[i]<0||value[i]>32)fail(label+" values must be finite and bounded.");
        return value;
    }
    function setTextStyle(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        var group=layer.property("ADBE Text Properties"),prop=group?group.property("ADBE Text Document"):null;
        if(!prop)fail("Target layer has no Source Text property.");
        var doc=prop.value;
        if(args.text!==undefined){var text=String(args.text);if(text.length>16384)fail("Text exceeds 16 KiB.");doc.text=text;}
        if(args.font!==undefined)doc.font=boundedString(args.font,240,"font PostScript name");
        if(args.font_size!==undefined){if(!finiteNumber(args.font_size)||args.font_size<0.1||args.font_size>1296)fail("font_size outside 0.1..1296.");doc.fontSize=args.font_size;}
        if(args.tracking!==undefined){if(!finiteNumber(args.tracking)||Math.abs(args.tracking)>10000)fail("tracking outside bounded range.");doc.tracking=args.tracking;}
        if(args.fill_color!==undefined){doc.applyFill=true;doc.fillColor=validateColor(args.fill_color,"fill_color");}
        if(args.apply_fill!==undefined){if(typeof args.apply_fill!=="boolean")fail("apply_fill must be boolean.");doc.applyFill=args.apply_fill;}
        if(args.stroke_color!==undefined){doc.applyStroke=true;doc.strokeColor=validateColor(args.stroke_color,"stroke_color");}
        if(args.stroke_width!==undefined){if(!finiteNumber(args.stroke_width)||args.stroke_width<0||args.stroke_width>1000)fail("stroke_width outside range.");doc.strokeWidth=args.stroke_width;}
        if(args.apply_stroke!==undefined){if(typeof args.apply_stroke!=="boolean")fail("apply_stroke must be boolean.");doc.applyStroke=args.apply_stroke;}
        if(args.justification!==undefined)doc.justification=justificationEnum(boundedString(args.justification,16,"justification"));
        app.beginUndoGroup("Shuvi: Style text");
        try{prop.setValue(doc);}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);prop=layer.property("ADBE Text Properties").property("ADBE Text Document");
        var read=prop.value,verified=true;
        if(args.text!==undefined&&String(read.text)!==String(args.text))verified=false;
        if(args.font!==undefined&&String(read.font)!==String(args.font))verified=false;
        if(args.font_size!==undefined&&Math.abs(read.fontSize-args.font_size)>EPSILON)verified=false;
        if(args.tracking!==undefined&&Math.abs(read.tracking-args.tracking)>EPSILON)verified=false;
        if(args.apply_fill!==undefined&&!!read.applyFill!==args.apply_fill)verified=false;
        if(args.fill_color!==undefined&&(!read.applyFill||!sameValue(read.fillColor,args.fill_color)))verified=false;
        if(args.apply_stroke!==undefined&&!!read.applyStroke!==args.apply_stroke)verified=false;
        if(args.stroke_color!==undefined&&(!read.applyStroke||!sameValue(read.strokeColor,args.stroke_color)))verified=false;
        if(args.stroke_width!==undefined&&Math.abs(read.strokeWidth-args.stroke_width)>EPSILON)verified=false;
        if(args.justification!==undefined&&read.justification!==justificationEnum(args.justification))verified=false;
        return {native_accepted:true,verification_status:verified?"verified_text_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,text:String(read.text),font:String(read.font),font_size:read.fontSize,
            apply_fill:!!read.applyFill,apply_stroke:!!read.applyStroke,tracking:read.tracking};
    }
    function interpolationEnum(name) {
        if(name==="linear")return KeyframeInterpolationType.LINEAR;
        if(name==="bezier")return KeyframeInterpolationType.BEZIER;
        if(name==="hold")return KeyframeInterpolationType.HOLD;
        fail("Unsupported keyframe interpolation type.");
    }
    function setKeyframeInterpolation(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,index=args.key_index;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys)fail("Invalid key_index.");
        var inType=interpolationEnum(boundedString(args.in_type,16,"incoming interpolation"));
        var outType=args.out_type===undefined?inType:interpolationEnum(boundedString(args.out_type,16,"outgoing interpolation"));
        if(!p.isInterpolationTypeValid(inType)||!p.isInterpolationTypeValid(outType))fail("Requested interpolation is invalid for this property.");
        app.beginUndoGroup("Shuvi: Set keyframe interpolation");
        try{p.setInterpolationTypeAtKey(index,inType,outType);}finally{app.endUndoGroup();}
        resolved=resolveProperty(args.property);p=resolved.property;
        var verified=p.keyInInterpolationType(index)===inType&&p.keyOutInterpolationType(index)===outType;
        return {native_accepted:true,verification_status:verified?"verified_keyframe_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,key_index:index,key_time:p.keyTime(index),in_type:args.in_type,out_type:args.out_type||args.in_type};
    }
    function removeKeyframe(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,index=args.key_index,expected=args.expected_time_seconds;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys||!finiteNumber(expected)||expected<0||expected>10800)
            fail("remove_keyframe requires valid key_index and expected_time_seconds.");
        var actual=p.keyTime(index);
        if(Math.abs(actual-expected)>EPSILON)fail("Keyframe time stale guard changed.");
        var before=p.numKeys;
        app.beginUndoGroup("Shuvi: Remove keyframe");
        try{p.removeKey(index);}finally{app.endUndoGroup();}
        resolved=resolveProperty(args.property);p=resolved.property;
        var stillPresent=false,i;for(i=1;i<=p.numKeys;i++)if(Math.abs(p.keyTime(i)-expected)<=EPSILON){stillPresent=true;break;}
        var verified=p.numKeys===before-1&&!stillPresent;
        return {native_accepted:true,verification_status:verified?"verified_keyframe_delta":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,removed_time_seconds:expected,before_num_keys:before,after_num_keys:p.numKeys};
    }
    function keyframeEaseArray(value,label,expectedLength) {
        if(!(value instanceof Array)||value.length!==expectedLength||value.length<1||value.length>8) fail(label+" must match the host keyframe ease dimension count.");
        var out=[],i;
        for(i=0;i<value.length;i++){
            var item=value[i];
            if(!item||!finiteNumber(item.speed)||!finiteNumber(item.influence)||item.influence<0.1||item.influence>100||Math.abs(item.speed)>1000000000)
                fail(label+" contains invalid speed/influence.");
            out.push(new KeyframeEase(item.speed,item.influence));
        }
        return out;
    }
    function easeSnapshot(items) {
        var out=[],i;for(i=0;i<items.length;i++)out.push({speed:items[i].speed,influence:items[i].influence});return out;
    }
    function sameEase(actual,requested) {
        if(actual.length!==requested.length)return false;
        var i;for(i=0;i<actual.length;i++)if(Math.abs(actual[i].speed-requested[i].speed)>EPSILON||Math.abs(actual[i].influence-requested[i].influence)>EPSILON)return false;
        return true;
    }
    function setKeyframeTemporalEase(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,index=args.key_index;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys)fail("Invalid key_index.");
        var existingIn=p.keyInTemporalEase(index),existingOut=p.keyOutTemporalEase(index);
        var inEase=keyframeEaseArray(args.in_ease,"in_ease",existingIn.length);
        var outEase=keyframeEaseArray(args.out_ease,"out_ease",existingOut.length);
        var time=p.keyTime(index);
        app.beginUndoGroup("Shuvi: Set temporal ease");
        try{p.setTemporalEaseAtKey(index,inEase,outEase);}finally{app.endUndoGroup();}
        resolved=resolveProperty(args.property);p=resolved.property;
        if(index>p.numKeys||Math.abs(p.keyTime(index)-time)>EPSILON)fail("Keyframe identity changed during temporal ease write.");
        var afterIn=easeSnapshot(p.keyInTemporalEase(index)),afterOut=easeSnapshot(p.keyOutTemporalEase(index));
        var requestedIn=easeSnapshot(inEase),requestedOut=easeSnapshot(outEase);
        var verified=sameEase(afterIn,requestedIn)&&sameEase(afterOut,requestedOut);
        return {native_accepted:true,verification_status:verified?"verified_temporal_ease_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,key_index:index,key_time:time,in_ease:afterIn,out_ease:afterOut};
    }
    function setLayerTiming(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        if(layer.locked)fail("Layer is locked; timing mutation refused.");
        var requested={},requestedCount=0;
        if(args.start_time!==undefined){if(!finiteNumber(args.start_time)||args.start_time<-10800||args.start_time>10800)fail("start_time outside AE bounds.");requested.startTime=args.start_time;requestedCount++;}
        if(args.stretch!==undefined){if(!finiteNumber(args.stretch)||args.stretch===0||args.stretch<-9900||args.stretch>9900||Math.abs(args.stretch)<1)fail("stretch must be -9900..-1 or 1..9900.");requested.stretch=args.stretch;requestedCount++;}
        if(args.in_point!==undefined){if(!finiteNumber(args.in_point)||args.in_point<-10800||args.in_point>10800)fail("in_point outside AE bounds.");requested.inPoint=args.in_point;requestedCount++;}
        if(args.out_point!==undefined){if(!finiteNumber(args.out_point)||args.out_point<-10800||args.out_point>10800)fail("out_point outside AE bounds.");requested.outPoint=args.out_point;requestedCount++;}
        if(requestedCount===0)fail("set_layer_timing requires at least one requested field.");
        var desiredIn=requested.inPoint!==undefined?requested.inPoint:layer.inPoint;
        var desiredOut=requested.outPoint!==undefined?requested.outPoint:layer.outPoint;
        if(desiredOut<=desiredIn)fail("Layer out_point must remain greater than in_point.");
        var before={start_time:layer.startTime,in_point:layer.inPoint,out_point:layer.outPoint,stretch:layer.stretch};
        app.beginUndoGroup("Shuvi: Set layer timing");
        try{
            if(requested.startTime!==undefined)layer.startTime=requested.startTime;
            if(requested.stretch!==undefined)layer.stretch=requested.stretch;
            if(requested.inPoint!==undefined)layer.inPoint=requested.inPoint;
            if(requested.outPoint!==undefined)layer.outPoint=requested.outPoint;
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after={start_time:layer.startTime,in_point:layer.inPoint,out_point:layer.outPoint,stretch:layer.stretch};
        var verified=true;
        if(requested.startTime!==undefined&&Math.abs(after.start_time-requested.startTime)>EPSILON)verified=false;
        if(requested.stretch!==undefined&&Math.abs(after.stretch-requested.stretch)>EPSILON)verified=false;
        if(requested.inPoint!==undefined&&Math.abs(after.in_point-requested.inPoint)>EPSILON)verified=false;
        if(requested.outPoint!==undefined&&Math.abs(after.out_point-requested.outPoint)>EPSILON)verified=false;
        return {native_accepted:true,verification_status:verified?"verified_timing_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before:before,after:after};
    }
    function markerTarget(args) {
        var comp=resolveComp(args.comp_id),scope=args.scope===undefined?"layer":boundedString(args.scope,16,"marker scope");
        if(scope==="comp")return {comp:comp,layer:null,property:comp.markerProperty,scope:"comp"};
        if(scope!=="layer")fail("Marker scope must be comp or layer.");
        var layer=resolveLayer(comp,args.layer_id);
        return {comp:comp,layer:layer,property:layer.marker,scope:"layer"};
    }
    function markerValueSnapshot(value) {
        return {comment:String(value.comment||""),duration:value.duration||0,label:value.label===undefined?0:value.label};
    }
    function inspectMarkers(args) {
        var target=markerTarget(args),p=target.property;
        var limit=Math.min(p.numKeys,1024),items=[],i;
        for(i=1;i<=limit;i++){
            var value=p.keyValue(i),snap=markerValueSnapshot(value);
            items.push({key_index:i,time_seconds:p.keyTime(i),comment:snap.comment,duration:snap.duration,label:snap.label});
        }
        return {verification_status:"verified_readback",scope:target.scope,comp_id:target.comp.id,
            layer_id:target.layer?target.layer.id:null,num_markers:p.numKeys,scan_truncated:p.numKeys>1024,markers:items};
    }
    function addMarker(args) {
        var target=markerTarget(args),p=target.property,time=args.time_seconds;
        if(!finiteNumber(time)||time<0||time>10800)fail("Marker time must be 0..10800 seconds.");
        if(p.numKeys>10000)fail("Marker count exceeds safety bound.");
        var comment=args.comment===undefined?"":String(args.comment);
        if(comment.length>2000)fail("Marker comment exceeds 2000 characters.");
        var duration=args.duration_seconds===undefined?0:args.duration_seconds;
        if(!finiteNumber(duration)||duration<0||duration>10800)fail("Marker duration outside bounds.");
        var label=args.label===undefined?0:args.label;
        if(!finiteNumber(label)||Math.floor(label)!==label||label<0||label>16)fail("Marker label must be 0..16.");
        var i;
        for(i=1;i<=p.numKeys;i++)if(Math.abs(p.keyTime(i)-time)<=EPSILON)fail("Marker already exists at requested time; mutation refused.");
        var before=p.numKeys,mv=new MarkerValue(comment);mv.duration=duration;mv.label=label;
        app.beginUndoGroup("Shuvi: Add marker");
        try{p.setValueAtTime(time,mv);}finally{app.endUndoGroup();}
        target=markerTarget(args);p=target.property;
        var foundIndex=0;
        for(i=1;i<=p.numKeys;i++)if(Math.abs(p.keyTime(i)-time)<=EPSILON){foundIndex=i;break;}
        var read=foundIndex?p.keyValue(foundIndex):null,snap=read?markerValueSnapshot(read):null;
        var verified=p.numKeys===before+1&&foundIndex>0&&snap&&snap.comment===comment
            &&Math.abs(snap.duration-duration)<=EPSILON&&snap.label===label;
        return {native_accepted:true,verification_status:verified?"verified_marker_delta":"accepted_unverified",retry_safe:false,
            scope:target.scope,comp_id:target.comp.id,layer_id:target.layer?target.layer.id:null,key_index:foundIndex,
            time_seconds:time,comment:snap?snap.comment:null,duration:snap?snap.duration:null,label:snap?snap.label:null,
            before_count:before,after_count:p.numKeys};
    }
    function removeMarker(args) {
        var target=markerTarget(args),p=target.property,index=args.key_index,time=args.expected_time_seconds;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys||!finiteNumber(time)||time<0||time>10800)
            fail("remove_marker requires valid key_index and expected_time_seconds.");
        if(Math.abs(p.keyTime(index)-time)>EPSILON)fail("Marker time stale guard changed.");
        var value=p.keyValue(index),comment=String(value.comment||"");
        if(args.expected_comment!==undefined&&comment!==String(args.expected_comment))fail("Marker comment stale guard changed.");
        var before=p.numKeys;
        app.beginUndoGroup("Shuvi: Remove marker");
        try{p.removeKey(index);}finally{app.endUndoGroup();}
        target=markerTarget(args);p=target.property;
        var exists=false,i;for(i=1;i<=p.numKeys;i++)if(Math.abs(p.keyTime(i)-time)<=EPSILON){exists=true;break;}
        var verified=p.numKeys===before-1&&!exists;
        return {native_accepted:true,verification_status:verified?"verified_marker_delta":"accepted_unverified",retry_safe:false,
            scope:target.scope,comp_id:target.comp.id,layer_id:target.layer?target.layer.id:null,
            removed_time_seconds:time,removed_comment:comment,before_count:before,after_count:p.numKeys};
    }
    function validateColor4(value,label) {
        if(!(value instanceof Array)||value.length!==4)fail(label+" must be [r,g,b,a].");
        var i;for(i=0;i<4;i++)if(!finiteNumber(value[i])||value[i]<0||value[i]>1)fail(label+" values must be 0..1.");
        return [value[0],value[1],value[2],value[3]];
    }
    function validatePoint2(value,label,positive) {
        if(!(value instanceof Array)||value.length!==2||!finiteNumber(value[0])||!finiteNumber(value[1]))fail(label+" must be a finite [x,y] pair.");
        if(positive&&(value[0]<=0||value[1]<=0))fail(label+" values must be positive.");
        if(Math.abs(value[0])>1000000||Math.abs(value[1])>1000000)fail(label+" exceeds bounded coordinate range.");
        return [value[0],value[1]];
    }
    function addShapePrimitive(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        var root=layer.property("ADBE Root Vectors Group");
        if(!root||!root.canAddProperty("ADBE Vector Group"))fail("Target layer is not a writable shape layer.");
        if(root.numProperties>256)fail("Shape root exceeds 256 groups.");
        var kind=boundedString(args.kind,16,"shape primitive kind");
        var shapeMatch=kind==="rectangle"?"ADBE Vector Shape - Rect":kind==="ellipse"?"ADBE Vector Shape - Ellipse":null;
        if(!shapeMatch)fail("Shape primitive kind must be rectangle or ellipse.");
        var size=validatePoint2(args.size,"shape size",true);
        var position=args.position===undefined?[0,0]:validatePoint2(args.position,"shape position",false);
        var roundness=args.roundness===undefined?0:args.roundness;
        if(!finiteNumber(roundness)||roundness<0||roundness>100000)fail("Shape roundness outside bounds.");
        var fill=args.fill_color===undefined?null:validateColor4(args.fill_color,"fill_color");
        var stroke=args.stroke_color===undefined?null:validateColor4(args.stroke_color,"stroke_color");
        var strokeWidth=args.stroke_width===undefined?1:args.stroke_width;
        if(!finiteNumber(strokeWidth)||strokeWidth<0||strokeWidth>10000)fail("stroke_width outside bounds.");
        if(!fill&&!stroke)fail("Shape primitive requires fill_color and/or stroke_color.");
        var before=root.numProperties,groupIndex,shapeIndex,fillIndex=null,strokeIndex=null;
        app.beginUndoGroup("Shuvi: Add shape primitive");
        try{
            var group=root.addProperty("ADBE Vector Group");groupIndex=group.propertyIndex;
            root=resolveLayer(comp,args.layer_id).property("ADBE Root Vectors Group");
            group=root.property(groupIndex);
            var vectors=group.property("ADBE Vectors Group");
            if(!vectors||!vectors.canAddProperty(shapeMatch))fail("Shape contents cannot add requested primitive.");
            var shape=vectors.addProperty(shapeMatch);shapeIndex=shape.propertyIndex;
            root=resolveLayer(comp,args.layer_id).property("ADBE Root Vectors Group");group=root.property(groupIndex);vectors=group.property("ADBE Vectors Group");shape=vectors.property(shapeIndex);
            var sizeProp=shape.property(kind==="rectangle"?"ADBE Vector Rect Size":"ADBE Vector Ellipse Size");
            var posProp=shape.property(kind==="rectangle"?"ADBE Vector Rect Position":"ADBE Vector Ellipse Position");
            sizeProp.setValue(size);posProp.setValue(position);
            if(kind==="rectangle")shape.property("ADBE Vector Rect Roundness").setValue(roundness);
            if(fill){
                var fillProp=vectors.addProperty("ADBE Vector Graphic - Fill");fillIndex=fillProp.propertyIndex;
                root=resolveLayer(comp,args.layer_id).property("ADBE Root Vectors Group");group=root.property(groupIndex);vectors=group.property("ADBE Vectors Group");
                fillProp=vectors.property(fillIndex);fillProp.property("ADBE Vector Fill Color").setValue(fill);
            }
            if(stroke){
                root=resolveLayer(comp,args.layer_id).property("ADBE Root Vectors Group");group=root.property(groupIndex);vectors=group.property("ADBE Vectors Group");
                var strokeProp=vectors.addProperty("ADBE Vector Graphic - Stroke");strokeIndex=strokeProp.propertyIndex;
                root=resolveLayer(comp,args.layer_id).property("ADBE Root Vectors Group");group=root.property(groupIndex);vectors=group.property("ADBE Vectors Group");
                strokeProp=vectors.property(strokeIndex);strokeProp.property("ADBE Vector Stroke Color").setValue(stroke);
                strokeProp.property("ADBE Vector Stroke Width").setValue(strokeWidth);
            }
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);root=layer.property("ADBE Root Vectors Group");
        var readGroup=root.property(groupIndex),readVectors=readGroup?readGroup.property("ADBE Vectors Group"):null;
        var readShape=readVectors?readVectors.property(shapeIndex):null;
        var verified=root.numProperties===before+1&&readShape&&readShape.matchName===shapeMatch;
        if(verified){
            var readSize=readShape.property(kind==="rectangle"?"ADBE Vector Rect Size":"ADBE Vector Ellipse Size").value;
            var readPos=readShape.property(kind==="rectangle"?"ADBE Vector Rect Position":"ADBE Vector Ellipse Position").value;
            verified=sameValue(readSize,size)&&sameValue(readPos,position);
            if(kind==="rectangle"&&Math.abs(readShape.property("ADBE Vector Rect Roundness").value-roundness)>EPSILON)verified=false;
            if(fill){
                var rf=readVectors.property(fillIndex);if(!rf||rf.matchName!=="ADBE Vector Graphic - Fill"||!sameValue(rf.property("ADBE Vector Fill Color").value,fill))verified=false;
            }
            if(stroke){
                var rs=readVectors.property(strokeIndex);if(!rs||rs.matchName!=="ADBE Vector Graphic - Stroke"
                    ||!sameValue(rs.property("ADBE Vector Stroke Color").value,stroke)||Math.abs(rs.property("ADBE Vector Stroke Width").value-strokeWidth)>EPSILON)verified=false;
            }
        }
        return {native_accepted:true,verification_status:verified?"verified_shape_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer.id,group_property_index:groupIndex,shape_property_index:shapeIndex,
            fill_property_index:fillIndex,stroke_property_index:strokeIndex,kind:kind};
    }
    function textAnimatorPropertyAllowed(matchName) {
        return matchName==="ADBE Text Opacity"||matchName==="ADBE Text Position 3D"||matchName==="ADBE Text Scale 3D"
            ||matchName==="ADBE Text Rotation"||matchName==="ADBE Text Fill Color"||matchName==="ADBE Text Stroke Color";
    }
    function addTextAnimator(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        var text=layer.property("ADBE Text Properties"),animators=text?text.property("ADBE Text Animators"):null;
        if(!animators||!animators.canAddProperty("ADBE Text Animator"))fail("Target layer cannot add text animators.");
        if(animators.numProperties>64)fail("Text animator count exceeds 64-item bound.");
        var propertyMatch=boundedString(args.property_match_name,160,"text animator property matchName");
        if(!textAnimatorPropertyAllowed(propertyMatch))fail("Text animator property is outside Shuvi allowlist.");
        var value=cloneValue(args.value);
        var start=args.start_percent===undefined?0:args.start_percent,end=args.end_percent===undefined?100:args.end_percent,offset=args.offset_percent===undefined?0:args.offset_percent;
        if(!finiteNumber(start)||!finiteNumber(end)||!finiteNumber(offset)||start<-10000||start>10000||end<-10000||end>10000||offset<-10000||offset>10000)
            fail("Text animator range values exceed bounds.");
        var before=animators.numProperties,animatorIndex,propertyIndex,selectorIndex;
        app.beginUndoGroup("Shuvi: Add text animator");
        try{
            var animator=animators.addProperty("ADBE Text Animator");animatorIndex=animator.propertyIndex;
            text=resolveLayer(comp,args.layer_id).property("ADBE Text Properties");animators=text.property("ADBE Text Animators");animator=animators.property(animatorIndex);
            var props=animator.property("ADBE Text Animator Properties");
            if(!props||!props.canAddProperty(propertyMatch))fail("Animator cannot add requested property.");
            var property=props.addProperty(propertyMatch);propertyIndex=property.propertyIndex;
            text=resolveLayer(comp,args.layer_id).property("ADBE Text Properties");animators=text.property("ADBE Text Animators");animator=animators.property(animatorIndex);
            props=animator.property("ADBE Text Animator Properties");property=props.property(propertyIndex);property.setValue(value);
            var selectors=animator.property("ADBE Text Selectors");
            if(!selectors||!selectors.canAddProperty("ADBE Text Selector"))fail("Animator cannot add range selector.");
            var selector=selectors.addProperty("ADBE Text Selector");selectorIndex=selector.propertyIndex;
            text=resolveLayer(comp,args.layer_id).property("ADBE Text Properties");animators=text.property("ADBE Text Animators");animator=animators.property(animatorIndex);
            selectors=animator.property("ADBE Text Selectors");selector=selectors.property(selectorIndex);
            selector.property("ADBE Text Percent Start").setValue(start);
            selector.property("ADBE Text Percent End").setValue(end);
            selector.property("ADBE Text Percent Offset").setValue(offset);
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);text=layer.property("ADBE Text Properties");animators=text.property("ADBE Text Animators");
        var readAnimator=animators.property(animatorIndex),readProps=readAnimator?readAnimator.property("ADBE Text Animator Properties"):null;
        var readProperty=readProps?readProps.property(propertyIndex):null,readSelectors=readAnimator?readAnimator.property("ADBE Text Selectors"):null;
        var readSelector=readSelectors?readSelectors.property(selectorIndex):null;
        var verified=animators.numProperties===before+1&&readProperty&&readProperty.matchName===propertyMatch&&sameValue(readProperty.value,value)
            &&readSelector&&Math.abs(readSelector.property("ADBE Text Percent Start").value-start)<=EPSILON
            &&Math.abs(readSelector.property("ADBE Text Percent End").value-end)<=EPSILON
            &&Math.abs(readSelector.property("ADBE Text Percent Offset").value-offset)<=EPSILON;
        return {native_accepted:true,verification_status:verified?"verified_text_animator_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer.id,animator_property_index:animatorIndex,property_index:propertyIndex,
            selector_property_index:selectorIndex,property_match_name:propertyMatch};
    }
    function inspectRenderQueue() {
        var queue = requireProject().renderQueue;
        var items = [], i, limit = Math.min(queue.numItems, 256);
        for (i = 1; i <= limit; i++) {
            var item = queue.item(i);
            var output = item.numOutputModules > 0 ? item.outputModule(1) : null;
            items.push({
                index: i,
                comp_id: item.comp ? item.comp.id : null,
                status: String(item.status),
                render_enabled: !!item.render,
                elapsed_seconds: item.elapsedSeconds,
                output_file: output && output.file ? output.file.fsName : null
            });
        }
        return {
            verification_status: "verified_readback",
            rendering: !!queue.rendering,
            num_items: queue.numItems,
            scan_truncated: queue.numItems > 256,
            items: items
        };
    }
    function addRenderQueueItem(args) {
        var comp = resolveComp(args.comp_id);
        var queue = requireProject().renderQueue;
        var before = queue.numItems;
        app.beginUndoGroup("Shuvi: Add render queue item");
        var item;
        try {
            item = queue.items.add(comp);
            if (args.render_settings_template) {
                item.applyTemplate(boundedString(args.render_settings_template, 240, "render template"));
                item = queue.item(queue.numItems);
            }
            if (args.output_module_template || args.output_file) {
                var om = item.outputModule(1);
                if (args.output_module_template) {
                    om.applyTemplate(boundedString(args.output_module_template, 240, "output module template"));
                    om = item.outputModule(1);
                }
                if (args.output_file) {
                    boundedString(args.output_file, 4096, "output file");
                    om.file = new File(args.output_file);
                    om = item.outputModule(1);
                }
            }
        } finally { app.endUndoGroup(); }

        var after = queue.numItems;
        var latest = after > 0 ? queue.item(after) : null;
        var output = latest && latest.numOutputModules > 0 ? latest.outputModule(1) : null;
        var compVerified = after === before + 1 && latest && latest.comp && latest.comp.id === comp.id;
        var outputVerified = !args.output_file || (output && output.file && output.file.fsName === new File(args.output_file).fsName);
        var verified = compVerified && outputVerified;
        return {
            native_accepted: true,
            verification_status: verified ? "verified_delta" : "accepted_unverified",
            retry_safe: false,
            queue_index: after,
            comp_id: comp.id,
            before_count: before,
            after_count: after,
            output_file: output && output.file ? output.file.fsName : null,
            render_completion_verified: false
        };
    }
    function saveProject() {
        var project = requireProject();
        if (!project.file) fail("Project must already have an exact file path; Save As is not automated here.");
        var before = project.file.fsName;
        app.project.save();
        var after = project.file ? project.file.fsName : null;
        return {
            native_accepted: true,
            verification_status: before === after ? "accepted_unverified" : "uncertain",
            retry_safe: false,
            project_file: after,
            persistence_verification_required_desktop_side: true
        };
    }
    function sameProjectPath(expected, actual) {
        if (!expected || !actual) return false;
        var a = new File(expected).fsName;
        var b = new File(actual).fsName;
        var windows = String($.os).toLowerCase().indexOf("windows") >= 0;
        return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
    }
    function mutationAction(action) {
        return action === "set_property" || action === "set_values_at_times" || action === "set_expression"
            || action === "add_effect" || action === "remove_effect" || action === "add_null" || action === "add_text" || action === "add_shape" || action === "add_solid"
            || action === "add_camera" || action === "add_light" || action === "create_comp" || action === "import_footage" || action === "add_item_layer"
            || action === "set_layer_state" || action === "set_layer_parent"
            || action === "move_layer" || action === "set_track_matte" || action === "remove_track_matte"
            || action === "set_time_remap" || action === "replace_source" || action === "set_text_style" || action === "set_layer_timing"
            || action === "add_shape_primitive" || action === "add_text_animator"
            || action === "set_keyframe_interpolation" || action === "set_keyframe_temporal_ease" || action === "remove_keyframe"
            || action === "duplicate_layer" || action === "remove_layer" || action === "precompose_layers"
            || action === "add_mask" || action === "add_scene_edit_markers" || action === "add_marker" || action === "remove_marker"
            || action === "add_render_queue_item" || action === "save_project";
    }
    function assertProjectExpectation(request, action) {
        if (!mutationAction(action)) return;
        var expected = request.expected_project_file;
        if (typeof expected !== "string" || expected.length === 0 || expected.length > 4096) {
            fail("Mutating After Effects action requires exact expected_project_file.");
        }
        var project = requireProject();
        if (!project.file || !sameProjectPath(expected, project.file.fsName)) {
            fail("Active After Effects project file changed; mutation refused.");
        }
    }
    function dispatch(request) {
        if (!request || request.schema_version !== 1) fail("Unsupported Shuvi After Effects request schema.");
        var action = boundedString(request.action, 80, "action");
        assertProjectExpectation(request, action);
        var args = request.args || {};
        if (action === "inspect_context") return inspectContext();
        if (action === "inspect_comp") return inspectComp(args);
        if (action === "inspect_property") return inspectProperty(args);
        if (action === "set_property") return setProperty(args);
        if (action === "set_values_at_times") return setValuesAtTimes(args);
        if (action === "set_expression") return setExpression(args);
        if (action === "add_effect") return addEffect(args);
        if (action === "remove_effect") return removeEffect(args);
        if (action === "add_null") return addNull(args);
        if (action === "add_text") return addText(args);
        if (action === "add_shape") return addShape(args);
        if (action === "add_solid") return addSolid(args);
        if (action === "add_camera") return addCamera(args);
        if (action === "add_light") return addLight(args);
        if (action === "create_comp") return createComp(args);
        if (action === "import_footage") return importFootage(args);
        if (action === "add_item_layer") return addItemLayer(args);
        if (action === "set_layer_state") return setLayerState(args);
        if (action === "set_layer_parent") return setLayerParent(args);
        if (action === "move_layer") return moveLayer(args);
        if (action === "set_track_matte") return setTrackMatte(args);
        if (action === "remove_track_matte") return removeTrackMatte(args);
        if (action === "set_time_remap") return setTimeRemap(args);
        if (action === "replace_source") return replaceSource(args);
        if (action === "set_text_style") return setTextStyle(args);
        if (action === "set_layer_timing") return setLayerTiming(args);
        if (action === "add_shape_primitive") return addShapePrimitive(args);
        if (action === "add_text_animator") return addTextAnimator(args);
        if (action === "set_keyframe_interpolation") return setKeyframeInterpolation(args);
        if (action === "set_keyframe_temporal_ease") return setKeyframeTemporalEase(args);
        if (action === "remove_keyframe") return removeKeyframe(args);
        if (action === "duplicate_layer") return duplicateLayer(args);
        if (action === "remove_layer") return removeLayer(args);
        if (action === "precompose_layers") return precomposeLayers(args);
        if (action === "add_mask") return addMask(args);
        if (action === "inspect_scene_edits") return inspectSceneEdits(args);
        if (action === "add_scene_edit_markers") return addSceneEditMarkers(args);
        if (action === "inspect_markers") return inspectMarkers(args);
        if (action === "add_marker") return addMarker(args);
        if (action === "remove_marker") return removeMarker(args);
        if (action === "inspect_render_queue") return inspectRenderQueue();
        if (action === "add_render_queue_item") return addRenderQueueItem(args);
        if (action === "save_project") return saveProject();
        fail("Unsupported Shuvi After Effects action.");
    }

    root.ShuviAE = {
        schemaVersion: 1,
        dispatch: dispatch
    };
})(this);
