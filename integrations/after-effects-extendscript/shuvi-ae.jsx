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
    function resolveLayer(comp, layerId) {
        if (!finiteNumber(layerId) || layerId <= 0 || Math.floor(layerId) !== layerId) fail("Exact positive layer_id required.");
        var limit = Math.min(comp.numLayers, MAX_LAYERS);
        var found = null, i;
        for (i = 1; i <= limit; i++) {
            var layer = comp.layer(i);
            if (layer && layer.id === layerId) {
                if (found) fail("Layer ID resolved ambiguously inside target composition.");
                found = layer;
            }
        }
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
            retry_safe: verified,
            comp_id: comp.id,
            layer_id: layer.id,
            effect_match_name: matchName,
            effect_property_index: addedIndex,
            before_count: beforeCount,
            after_count: afterCount
        };
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
            retry_safe: verified,
            comp_id: comp.id,
            layer_id: layer ? layer.id : null,
            layer_index: layer ? layer.index : null,
            before_count: before,
            after_count: comp.numLayers
        };
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
            retry_safe: verified,
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
        return action === "set_property" || action === "set_values_at_times" || action === "add_effect"
            || action === "add_null" || action === "add_render_queue_item" || action === "save_project";
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
        if (action === "add_effect") return addEffect(args);
        if (action === "add_null") return addNull(args);
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
