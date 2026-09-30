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
    function inspectEffects(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id),parade=layer.property("ADBE Effect Parade");
        var effects=[],i,count=parade?parade.numProperties:0,limit=Math.min(count,256);
        for(i=1;i<=limit;i++){
            var effect=parade.property(i);
            effects.push({property_index:i,match_name:String(effect.matchName),name:String(effect.name),enabled:effect.enabled===undefined?null:!!effect.enabled,
                num_properties:effect.numProperties===undefined?null:effect.numProperties});
        }
        return {verification_status:"verified_readback",comp_id:comp.id,layer_id:layer.id,num_effects:count,scan_truncated:count>256,effects:effects};
    }
    function inspectKeyframes(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,count=p.numKeys===undefined?0:p.numKeys;
        if(count>10000)fail("Keyframe count exceeds safety bound.");
        var limit=Math.min(count,512),keys=[],i;
        for(i=1;i<=limit;i++){
            var entry={key_index:i,time_seconds:p.keyTime(i),value:cloneValue(p.keyValue(i)),
                in_interpolation:String(p.keyInInterpolationType(i)),out_interpolation:String(p.keyOutInterpolationType(i))};
            try{
                entry.in_ease=easeSnapshot(p.keyInTemporalEase(i));
                entry.out_ease=easeSnapshot(p.keyOutTemporalEase(i));
                entry.temporal_auto_bezier=!!p.keyTemporalAutoBezier(i);
                entry.temporal_continuous=!!p.keyTemporalContinuous(i);
            }catch(ignore){}
            try{
                entry.in_spatial_tangent=cloneValue(p.keyInSpatialTangent(i));
                entry.out_spatial_tangent=cloneValue(p.keyOutSpatialTangent(i));
                entry.spatial_auto_bezier=!!p.keySpatialAutoBezier(i);
                entry.spatial_continuous=!!p.keySpatialContinuous(i);
                entry.roving=!!p.keyRoving(i);
            }catch(ignoreSpatial){}
            keys.push(entry);
        }
        return {verification_status:"verified_readback",comp_id:resolved.comp.id,layer_id:resolved.layer.id,
            property_match_name:String(p.matchName),property_index:p.propertyIndex,num_keys:count,scan_truncated:count>512,keyframes:keys};
    }
    function inspectPropertyNode(prop,depth,state) {
        if(!prop||state.count>=1024){state.truncated=true;return null;}
        state.count++;
        var node={name:String(prop.name).slice(0,240),match_name:String(prop.matchName),property_index:prop.propertyIndex,
            property_type:String(prop.propertyType),depth:depth};
        if(prop.propertyType===PropertyType.PROPERTY){
            node.value_type=String(prop.propertyValueType);
            node.num_keys=prop.numKeys;
            node.can_vary_over_time=!!prop.canVaryOverTime;
            if(prop.numKeys===0){try{node.value=cloneValue(prop.value);}catch(ignore){}}
            return node;
        }
        node.num_properties=prop.numProperties;
        if(depth>=6){node.children_truncated=prop.numProperties>0;return node;}
        var children=[],limit=Math.min(prop.numProperties,256),i;
        for(i=1;i<=limit;i++){
            if(state.count>=1024){state.truncated=true;break;}
            var child=inspectPropertyNode(prop.property(i),depth+1,state);if(child)children.push(child);
        }
        if(prop.numProperties>limit)state.truncated=true;
        node.children=children;
        return node;
    }
    function inspectLayerProperties(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id),state={count:0,truncated:false},roots=[];
        var names=["ADBE Transform Group","ADBE Effect Parade","ADBE Mask Parade","ADBE Text Properties","ADBE Root Vectors Group",
            "ADBE Material Options Group","ADBE Audio Group","ADBE Marker"];
        var i;
        for(i=0;i<names.length;i++){
            if(state.count>=1024){state.truncated=true;break;}
            var prop=null;try{prop=layer.property(names[i]);}catch(ignore){}
            if(prop){var node=inspectPropertyNode(prop,0,state);if(node)roots.push(node);}
        }
        return {verification_status:"verified_readback",comp_id:comp.id,layer_id:layer.id,node_count:state.count,
            scan_truncated:state.truncated,roots:roots};
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
            project_revision: project.revision,
            item_count: project.numItems,
            item_scan_truncated: project.numItems > MAX_ITEMS,
            active_comp_id: active && active instanceof CompItem ? active.id : null,
            compositions: comps
        };
    }
    function inspectProjectItems() {
        var project=requireProject(),items=[],limit=Math.min(project.numItems,MAX_ITEMS),i;
        for(i=1;i<=limit;i++){
            var item=project.item(i),kind="other",filePath=null;
            if(item instanceof CompItem)kind="comp";
            else if(item instanceof FootageItem){kind="footage";try{filePath=item.file?item.file.fsName:null;}catch(ignore){}}
            else if(item instanceof FolderItem)kind="folder";
            items.push({id:item.id,index:i,name:String(item.name).slice(0,240),kind:kind,parent_folder_id:item.parentFolder?item.parentFolder.id:null,
                file_path:filePath});
        }
        return {verification_status:"verified_readback",num_items:project.numItems,scan_truncated:project.numItems>MAX_ITEMS,items:items};
    }
    function itemKind(item) {
        if(item instanceof CompItem)return "comp";
        if(item instanceof FootageItem)return "footage";
        if(item instanceof FolderItem)return "folder";
        return "other";
    }
    function resolveFolder(folderId) {
        if(folderId===null||folderId===undefined)return requireProject().rootFolder;
        var folder=resolveItem(folderId);
        if(!(folder instanceof FolderItem))fail("Target parent item is not a project folder.");
        return folder;
    }
    function projectItemSnapshot(item) {
        return {item_id:item.id,name:String(item.name).slice(0,240),kind:itemKind(item),
            parent_folder_id:item.parentFolder?item.parentFolder.id:null,label:item.label===undefined?null:item.label,
            folder_child_count:item instanceof FolderItem?item.numItems:null};
    }
    function createProjectFolder(args) {
        var project=requireProject(),name=boundedString(args.name,120,"project folder name"),parent=resolveFolder(args.parent_folder_id);
        var before=project.numItems;
        app.beginUndoGroup("Shuvi: Create project folder");
        var folder;
        try{
            folder=project.items.addFolder(name);
            if(parent.id!==project.rootFolder.id)folder.parentFolder=parent;
        }finally{app.endUndoGroup();}
        var read=folder?project.itemByID(folder.id):null;
        var verified=project.numItems===before+1&&read&&read instanceof FolderItem&&String(read.name)===name
            &&read.parentFolder&&read.parentFolder.id===parent.id;
        return {native_accepted:true,verification_status:verified?"verified_project_folder_creation":"accepted_unverified",retry_safe:false,
            folder:read?projectItemSnapshot(read):null,before_item_count:before,after_item_count:project.numItems};
    }
    function folderMoveWouldCycle(item,parent) {
        if(!(item instanceof FolderItem))return false;
        var project=requireProject(),cursor=parent,guard=0;
        while(cursor&&guard<512){
            if(cursor.id===item.id)return true;
            if(cursor.id===project.rootFolder.id)return false;
            cursor=cursor.parentFolder;guard++;
        }
        return guard>=512;
    }
    function setProjectItemState(args) {
        var project=requireProject(),item=resolveItem(args.item_id),expectedName=boundedString(args.expected_name,240,"expected project item name");
        if(String(item.name)!==expectedName)fail("Project item name stale guard changed.");
        if(!args.hasOwnProperty("expected_parent_folder_id"))fail("Project item mutation requires expected_parent_folder_id stale guard.");
        var beforeParent=item.parentFolder?item.parentFolder.id:null;
        if(beforeParent!==args.expected_parent_folder_id)fail("Project item parent folder stale guard changed.");
        var requested={},count=0,parent=null;
        if(args.name!==undefined){requested.name=boundedString(args.name,240,"project item name");count++;}
        if(args.label!==undefined){
            if(!finiteNumber(args.label)||Math.floor(args.label)!==args.label||args.label<0||args.label>16)fail("Project item label must be 0..16.");
            requested.label=args.label;count++;
        }
        if(args.parent_folder_id!==undefined){
            parent=resolveFolder(args.parent_folder_id);
            if(folderMoveWouldCycle(item,parent))fail("Project folder move would create a parent cycle.");
            requested.parentFolderId=parent.id;count++;
        }
        if(count===0)fail("set_project_item_state requires name, label and/or parent_folder_id.");
        var before=projectItemSnapshot(item);
        app.beginUndoGroup("Shuvi: Set project item state");
        try{
            if(requested.name!==undefined)item.name=requested.name;
            if(requested.label!==undefined)item.label=requested.label;
            if(parent)item.parentFolder=parent;
        }finally{app.endUndoGroup();}
        item=project.itemByID(args.item_id);
        if(!item)fail("Project item disappeared during state mutation.");
        var after=projectItemSnapshot(item),verified=true;
        if(requested.name!==undefined&&after.name!==requested.name)verified=false;
        if(requested.label!==undefined&&after.label!==requested.label)verified=false;
        if(requested.parentFolderId!==undefined&&after.parent_folder_id!==requested.parentFolderId)verified=false;
        return {native_accepted:true,verification_status:verified?"verified_project_item_readback":"accepted_unverified",retry_safe:verified,
            item_id:item.id,before:before,after:after};
    }
    function removeProjectItem(args) {
        var project=requireProject(),item=resolveItem(args.item_id),expectedName=boundedString(args.expected_name,240,"expected project item name");
        if(String(item.name)!==expectedName)fail("Project item name stale guard changed.");
        var expectedKind=boundedString(args.expected_kind,16,"expected project item kind"),kind=itemKind(item);
        if(kind!==expectedKind)fail("Project item kind stale guard changed.");
        if(!args.hasOwnProperty("expected_parent_folder_id"))fail("Project item removal requires expected_parent_folder_id stale guard.");
        var parentId=item.parentFolder?item.parentFolder.id:null;
        if(parentId!==args.expected_parent_folder_id)fail("Project item parent folder stale guard changed.");
        if(item instanceof FolderItem&&item.numItems!==0)fail("Non-empty project folders cannot be removed automatically.");
        var id=item.id,before=project.numItems,snapshot=projectItemSnapshot(item);
        app.beginUndoGroup("Shuvi: Remove project item");
        try{item.remove();}finally{app.endUndoGroup();}
        var gone=project.itemByID(id)===null,verified=gone&&project.numItems===before-1;
        return {native_accepted:true,verification_status:verified?"verified_project_item_delta":"accepted_unverified",retry_safe:false,
            removed:snapshot,before_item_count:before,after_item_count:project.numItems};
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
            work_area_start: comp.workAreaStart,
            work_area_duration: comp.workAreaDuration,
            bg_color: cloneValue(comp.bgColor),
            motion_blur: !!comp.motionBlur,
            shutter_angle: comp.shutterAngle,
            shutter_phase: comp.shutterPhase,
            motion_blur_samples_per_frame: comp.motionBlurSamplesPerFrame,
            motion_blur_adaptive_sample_limit: comp.motionBlurAdaptiveSampleLimit,
            preserve_nested_frame_rate: !!comp.preserveNestedFrameRate,
            preserve_nested_resolution: !!comp.preserveNestedResolution,
            resolution_factor: cloneValue(comp.resolutionFactor),
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
    function maskModeFromName(name) {
        if(name==="none")return MaskMode.NONE;
        if(name==="add")return MaskMode.ADD;
        if(name==="subtract")return MaskMode.SUBTRACT;
        if(name==="intersect")return MaskMode.INTERSECT;
        if(name==="lighten")return MaskMode.LIGHTEN;
        if(name==="darken")return MaskMode.DARKEN;
        if(name==="difference")return MaskMode.DIFFERENCE;
        fail("Unsupported mask mode.");
    }
    function maskModeName(mode) {
        if(mode===MaskMode.NONE)return "none";
        if(mode===MaskMode.ADD)return "add";
        if(mode===MaskMode.SUBTRACT)return "subtract";
        if(mode===MaskMode.INTERSECT)return "intersect";
        if(mode===MaskMode.LIGHTEN)return "lighten";
        if(mode===MaskMode.DARKEN)return "darken";
        if(mode===MaskMode.DIFFERENCE)return "difference";
        return "unknown";
    }
    function maskSnapshot(mask) {
        var shape=mask.property("ADBE Mask Shape").value;
        return {name:String(mask.name),mode:maskModeName(mask.maskMode),inverted:!!mask.inverted,locked:!!mask.locked,
            vertices:cloneValue(shape.vertices),in_tangents:cloneValue(shape.inTangents),
            out_tangents:cloneValue(shape.outTangents),closed:!!shape.closed,
            feather:cloneValue(mask.property("ADBE Mask Feather").value),
            opacity:mask.property("ADBE Mask Opacity").value,
            expansion:mask.property("ADBE Mask Offset").value};
    }
    function validateMaskShape(args,current) {
        if(args.vertices===undefined)return null;
        if(!(args.vertices instanceof Array)||args.vertices.length<3||args.vertices.length>512)fail("Mask requires 3..512 vertices.");
        var vertices=[],inTangents=[],outTangents=[],i;
        for(i=0;i<args.vertices.length;i++){
            var v=args.vertices[i];
            if(!(v instanceof Array)||v.length!==2||!finiteNumber(v[0])||!finiteNumber(v[1]))fail("Mask vertices must be finite [x,y] pairs.");
            vertices.push([v[0],v[1]]);
            inTangents.push([0,0]);outTangents.push([0,0]);
        }
        if(args.in_tangents!==undefined){
            if(!(args.in_tangents instanceof Array)||args.in_tangents.length!==vertices.length)fail("Mask in_tangents length mismatch.");
            inTangents=args.in_tangents;
        }else if(current&&current.in_tangents&&current.in_tangents.length===vertices.length)inTangents=current.in_tangents;
        if(args.out_tangents!==undefined){
            if(!(args.out_tangents instanceof Array)||args.out_tangents.length!==vertices.length)fail("Mask out_tangents length mismatch.");
            outTangents=args.out_tangents;
        }else if(current&&current.out_tangents&&current.out_tangents.length===vertices.length)outTangents=current.out_tangents;
        for(i=0;i<vertices.length;i++){
            if(!(inTangents[i] instanceof Array)||inTangents[i].length!==2||!(outTangents[i] instanceof Array)||outTangents[i].length!==2
                ||!finiteNumber(inTangents[i][0])||!finiteNumber(inTangents[i][1])||!finiteNumber(outTangents[i][0])||!finiteNumber(outTangents[i][1]))
                fail("Mask tangents must be finite [x,y] pairs.");
        }
        return {vertices:vertices,inTangents:inTangents,outTangents:outTangents,closed:args.closed===undefined?(current?current.closed:true):args.closed!==false};
    }
    function editMask(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id),masks=layer.property("ADBE Mask Parade");
        var index=args.mask_property_index;
        if(!masks||!finiteNumber(index)||Math.floor(index)!==index||index<1||index>masks.numProperties)fail("Invalid mask_property_index.");
        var mask=masks.property(index);
        if(!mask||!mask.isMask)fail("Mask property index is stale.");
        var before=maskSnapshot(mask);
        if(args.expected_name!==undefined&&before.name!==String(args.expected_name))fail("Mask name stale guard changed.");
        if(args.expected_mode!==undefined&&before.mode!==String(args.expected_mode))fail("Mask mode stale guard changed.");
        if(mask.locked&&args.locked!==false)fail("Mask is locked; unlock explicitly before editing.");
        var nextShape=validateMaskShape(args,before),requestedCount=0;
        if(nextShape)requestedCount++;
        if(args.name!==undefined){boundedString(args.name,240,"mask name");requestedCount++;}
        if(args.mode!==undefined){maskModeFromName(boundedString(args.mode,24,"mask mode"));requestedCount++;}
        if(args.inverted!==undefined){if(typeof args.inverted!=="boolean")fail("mask inverted must be boolean.");requestedCount++;}
        if(args.locked!==undefined){if(typeof args.locked!=="boolean")fail("mask locked must be boolean.");requestedCount++;}
        if(args.feather!==undefined){validatePoint2(args.feather,"mask feather",false);requestedCount++;}
        if(args.opacity!==undefined){if(!finiteNumber(args.opacity)||args.opacity<0||args.opacity>100)fail("mask opacity must be 0..100.");requestedCount++;}
        if(args.expansion!==undefined){if(!finiteNumber(args.expansion)||Math.abs(args.expansion)>100000)fail("mask expansion outside bounds.");requestedCount++;}
        if(requestedCount===0)fail("edit_mask requires at least one requested change.");
        app.beginUndoGroup("Shuvi: Edit mask");
        try{
            if(args.locked===false)mask.locked=false;
            if(nextShape){var shape=new Shape();shape.vertices=nextShape.vertices;shape.inTangents=nextShape.inTangents;shape.outTangents=nextShape.outTangents;shape.closed=nextShape.closed;mask.property("ADBE Mask Shape").setValue(shape);}
            if(args.name!==undefined)mask.name=args.name;
            if(args.mode!==undefined)mask.maskMode=maskModeFromName(args.mode);
            if(args.inverted!==undefined)mask.inverted=args.inverted;
            if(args.feather!==undefined)mask.property("ADBE Mask Feather").setValue(args.feather);
            if(args.opacity!==undefined)mask.property("ADBE Mask Opacity").setValue(args.opacity);
            if(args.expansion!==undefined)mask.property("ADBE Mask Offset").setValue(args.expansion);
            if(args.locked===true)mask.locked=true;
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);masks=layer.property("ADBE Mask Parade");mask=masks.property(index);
        var after=maskSnapshot(mask),verified=true;
        if(nextShape&&( !samePointList(after.vertices,nextShape.vertices)||!samePointList(after.in_tangents,nextShape.inTangents)
            ||!samePointList(after.out_tangents,nextShape.outTangents)||after.closed!==nextShape.closed))verified=false;
        if(args.name!==undefined&&after.name!==String(args.name))verified=false;
        if(args.mode!==undefined&&after.mode!==String(args.mode))verified=false;
        if(args.inverted!==undefined&&after.inverted!==args.inverted)verified=false;
        if(args.locked!==undefined&&after.locked!==args.locked)verified=false;
        if(args.feather!==undefined&&!sameValue(after.feather,args.feather))verified=false;
        if(args.opacity!==undefined&&Math.abs(after.opacity-args.opacity)>EPSILON)verified=false;
        if(args.expansion!==undefined&&Math.abs(after.expansion-args.expansion)>EPSILON)verified=false;
        return {native_accepted:true,verification_status:verified?"verified_mask_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,mask_property_index:index,before:before,after:after};
    }
    function maskInventory(layer) {
        var masks=layer.property("ADBE Mask Parade"),out=[],i;
        if(!masks)return out;
        if(masks.numProperties>512)fail("Mask inventory exceeds safety bound.");
        for(i=1;i<=masks.numProperties;i++){
            var m=masks.property(i),shape=m.property("ADBE Mask Shape").value;
            out.push({name:String(m.name),mode:maskModeName(m.maskMode),inverted:!!m.inverted,vertex_count:shape.vertices.length,closed:!!shape.closed});
        }
        return out;
    }
    function sameMaskInventory(actual,expected) {
        if(actual.length!==expected.length)return false;
        var i;for(i=0;i<actual.length;i++){
            var a=actual[i],e=expected[i];
            if(a.name!==e.name||a.mode!==e.mode||a.inverted!==e.inverted||a.vertex_count!==e.vertex_count||a.closed!==e.closed)return false;
        }
        return true;
    }
    function removeMask(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id),masks=layer.property("ADBE Mask Parade");
        var index=args.mask_property_index;
        if(!masks||!finiteNumber(index)||Math.floor(index)!==index||index<1||index>masks.numProperties)fail("Invalid mask_property_index.");
        var mask=masks.property(index),snap=maskSnapshot(mask);
        if(args.expected_name!==undefined&&snap.name!==String(args.expected_name))fail("Mask name stale guard changed.");
        if(args.expected_mode!==undefined&&snap.mode!==String(args.expected_mode))fail("Mask mode stale guard changed.");
        if(mask.locked)fail("Mask is locked; remove refused until explicitly unlocked.");
        var before=maskInventory(layer),expectedAfter=[],i;
        for(i=0;i<before.length;i++)if(i!==index-1)expectedAfter.push(before[i]);
        app.beginUndoGroup("Shuvi: Remove mask");
        try{mask.remove();}finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var after=maskInventory(layer),verified=after.length===before.length-1&&sameMaskInventory(after,expectedAfter);
        return {native_accepted:true,verification_status:verified?"verified_mask_delta":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer.id,removed_mask_property_index:index,removed:before[index-1],
            before_masks:before,after_masks:after};
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
    function setCompSettings(args) {
        var comp=resolveComp(args.comp_id),requested={},count=0;
        function boolField(argKey,propKey){
            if(args[argKey]!==undefined){if(typeof args[argKey]!=="boolean")fail(argKey+" must be boolean.");requested[propKey]=args[argKey];count++;}
        }
        if(args.frame_rate!==undefined){
            if(!finiteNumber(args.expected_frame_rate)||Math.abs(comp.frameRate-args.expected_frame_rate)>EPSILON)fail("Composition frame-rate stale guard changed.");
            if(!finiteNumber(args.frame_rate)||args.frame_rate<1||args.frame_rate>99)fail("frame_rate must be 1..99.");
            requested.frameRate=args.frame_rate;count++;
        }
        if(args.work_area_start!==undefined||args.work_area_duration!==undefined){
            var start=args.work_area_start===undefined?comp.workAreaStart:args.work_area_start;
            var duration=args.work_area_duration===undefined?comp.workAreaDuration:args.work_area_duration;
            if(!finiteNumber(start)||!finiteNumber(duration)||start<0||duration<=0||start+duration>comp.duration+EPSILON)
                fail("Work area must be positive and remain inside composition duration.");
            requested.workAreaStart=start;requested.workAreaDuration=duration;count+=2;
        }
        if(args.bg_color!==undefined){
            var bg=args.bg_color;if(!(bg instanceof Array)||bg.length!==3)fail("bg_color must be [r,g,b].");
            var i;for(i=0;i<3;i++)if(!finiteNumber(bg[i])||bg[i]<0||bg[i]>1)fail("bg_color values must be 0..1.");
            requested.bgColor=[bg[0],bg[1],bg[2]];count++;
        }
        boolField("motion_blur","motionBlur");
        boolField("preserve_nested_frame_rate","preserveNestedFrameRate");
        boolField("preserve_nested_resolution","preserveNestedResolution");
        if(args.shutter_angle!==undefined){
            if(!finiteNumber(args.shutter_angle)||Math.floor(args.shutter_angle)!==args.shutter_angle||args.shutter_angle<0||args.shutter_angle>720)fail("shutter_angle must be 0..720.");
            requested.shutterAngle=args.shutter_angle;count++;
        }
        if(args.shutter_phase!==undefined){
            if(!finiteNumber(args.shutter_phase)||Math.floor(args.shutter_phase)!==args.shutter_phase||args.shutter_phase<-360||args.shutter_phase>360)fail("shutter_phase must be -360..360.");
            requested.shutterPhase=args.shutter_phase;count++;
        }
        if(args.motion_blur_samples_per_frame!==undefined){
            var samples=args.motion_blur_samples_per_frame;
            if(!finiteNumber(samples)||Math.floor(samples)!==samples||samples<2||samples>64)fail("motion_blur_samples_per_frame must be 2..64.");
            requested.motionBlurSamplesPerFrame=samples;count++;
        }
        if(args.motion_blur_adaptive_sample_limit!==undefined){
            var adaptive=args.motion_blur_adaptive_sample_limit;
            if(!finiteNumber(adaptive)||Math.floor(adaptive)!==adaptive||adaptive<16||adaptive>256)fail("motion_blur_adaptive_sample_limit must be 16..256.");
            requested.motionBlurAdaptiveSampleLimit=adaptive;count++;
        }
        if(args.resolution_factor!==undefined){
            var factor=args.resolution_factor;
            if(!(factor instanceof Array)||factor.length!==2||!finiteNumber(factor[0])||!finiteNumber(factor[1])
                ||Math.floor(factor[0])!==factor[0]||Math.floor(factor[1])!==factor[1]||factor[0]<1||factor[0]>99||factor[1]<1||factor[1]>99)
                fail("resolution_factor must be two integers in 1..99.");
            requested.resolutionFactor=[factor[0],factor[1]];count++;
        }
        if(count===0)fail("set_comp_settings requires at least one requested field.");
        var before={frame_rate:comp.frameRate,work_area_start:comp.workAreaStart,work_area_duration:comp.workAreaDuration,
            bg_color:cloneValue(comp.bgColor),motion_blur:!!comp.motionBlur,shutter_angle:comp.shutterAngle,shutter_phase:comp.shutterPhase,
            motion_blur_samples_per_frame:comp.motionBlurSamplesPerFrame,motion_blur_adaptive_sample_limit:comp.motionBlurAdaptiveSampleLimit,
            preserve_nested_frame_rate:!!comp.preserveNestedFrameRate,preserve_nested_resolution:!!comp.preserveNestedResolution,
            resolution_factor:cloneValue(comp.resolutionFactor)};
        app.beginUndoGroup("Shuvi: Set composition settings");
        try{
            if(requested.frameRate!==undefined)comp.frameRate=requested.frameRate;
            if(requested.workAreaStart!==undefined){comp.workAreaStart=requested.workAreaStart;comp.workAreaDuration=requested.workAreaDuration;}
            if(requested.bgColor!==undefined)comp.bgColor=requested.bgColor;
            if(requested.motionBlur!==undefined)comp.motionBlur=requested.motionBlur;
            if(requested.shutterAngle!==undefined)comp.shutterAngle=requested.shutterAngle;
            if(requested.shutterPhase!==undefined)comp.shutterPhase=requested.shutterPhase;
            if(requested.motionBlurSamplesPerFrame!==undefined)comp.motionBlurSamplesPerFrame=requested.motionBlurSamplesPerFrame;
            if(requested.motionBlurAdaptiveSampleLimit!==undefined)comp.motionBlurAdaptiveSampleLimit=requested.motionBlurAdaptiveSampleLimit;
            if(requested.preserveNestedFrameRate!==undefined)comp.preserveNestedFrameRate=requested.preserveNestedFrameRate;
            if(requested.preserveNestedResolution!==undefined)comp.preserveNestedResolution=requested.preserveNestedResolution;
            if(requested.resolutionFactor!==undefined)comp.resolutionFactor=requested.resolutionFactor;
        }finally{app.endUndoGroup();}
        comp=resolveComp(args.comp_id);
        var after={frame_rate:comp.frameRate,work_area_start:comp.workAreaStart,work_area_duration:comp.workAreaDuration,
            bg_color:cloneValue(comp.bgColor),motion_blur:!!comp.motionBlur,shutter_angle:comp.shutterAngle,shutter_phase:comp.shutterPhase,
            motion_blur_samples_per_frame:comp.motionBlurSamplesPerFrame,motion_blur_adaptive_sample_limit:comp.motionBlurAdaptiveSampleLimit,
            preserve_nested_frame_rate:!!comp.preserveNestedFrameRate,preserve_nested_resolution:!!comp.preserveNestedResolution,
            resolution_factor:cloneValue(comp.resolutionFactor)};
        var verified=true;
        if(requested.frameRate!==undefined&&Math.abs(after.frame_rate-requested.frameRate)>EPSILON)verified=false;
        if(requested.workAreaStart!==undefined&&(Math.abs(after.work_area_start-requested.workAreaStart)>EPSILON||Math.abs(after.work_area_duration-requested.workAreaDuration)>EPSILON))verified=false;
        if(requested.bgColor!==undefined&&!sameValue(after.bg_color,requested.bgColor))verified=false;
        if(requested.motionBlur!==undefined&&after.motion_blur!==requested.motionBlur)verified=false;
        if(requested.shutterAngle!==undefined&&after.shutter_angle!==requested.shutterAngle)verified=false;
        if(requested.shutterPhase!==undefined&&after.shutter_phase!==requested.shutterPhase)verified=false;
        if(requested.motionBlurSamplesPerFrame!==undefined&&after.motion_blur_samples_per_frame!==requested.motionBlurSamplesPerFrame)verified=false;
        if(requested.motionBlurAdaptiveSampleLimit!==undefined&&after.motion_blur_adaptive_sample_limit!==requested.motionBlurAdaptiveSampleLimit)verified=false;
        if(requested.preserveNestedFrameRate!==undefined&&after.preserve_nested_frame_rate!==requested.preserveNestedFrameRate)verified=false;
        if(requested.preserveNestedResolution!==undefined&&after.preserve_nested_resolution!==requested.preserveNestedResolution)verified=false;
        if(requested.resolutionFactor!==undefined&&!sameValue(after.resolution_factor,requested.resolutionFactor))verified=false;
        return {native_accepted:true,verification_status:verified?"verified_comp_settings_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,before:before,after:after};
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
    function setKeyframeTemporalFlags(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,index=args.key_index,expected=args.expected_time_seconds;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys
            ||!finiteNumber(expected)||expected<0||expected>10800) {
            fail("set_keyframe_temporal_flags requires valid key_index and expected_time_seconds.");
        }
        if(Math.abs(p.keyTime(index)-expected)>EPSILON)fail("Temporal keyframe time stale guard changed.");
        var hasAuto=args.auto_bezier!==undefined,hasContinuous=args.continuous!==undefined;
        if(!hasAuto&&!hasContinuous)fail("set_keyframe_temporal_flags requires auto_bezier and/or continuous.");
        if(hasAuto&&typeof args.auto_bezier!=="boolean")fail("auto_bezier must be boolean.");
        if(hasContinuous&&typeof args.continuous!=="boolean")fail("continuous must be boolean.");

        var inType=p.keyInInterpolationType(index),outType=p.keyOutInterpolationType(index);
        if((args.auto_bezier===true||args.continuous===true)
            &&(inType!==KeyframeInterpolationType.BEZIER||outType!==KeyframeInterpolationType.BEZIER)) {
            fail("Temporal auto-Bezier/continuous=true requires BEZIER incoming and outgoing interpolation.");
        }
        var before={auto_bezier:!!p.keyTemporalAutoBezier(index),continuous:!!p.keyTemporalContinuous(index)};
        app.beginUndoGroup("Shuvi: Set temporal keyframe flags");
        try{
            if(hasContinuous)p.setTemporalContinuousAtKey(index,args.continuous);
            if(hasAuto)p.setTemporalAutoBezierAtKey(index,args.auto_bezier);
        }finally{app.endUndoGroup();}
        resolved=resolveProperty(args.property);p=resolved.property;
        if(index>p.numKeys||Math.abs(p.keyTime(index)-expected)>EPSILON)fail("Temporal keyframe identity changed during mutation.");
        var after={auto_bezier:!!p.keyTemporalAutoBezier(index),continuous:!!p.keyTemporalContinuous(index)};
        var verified=(!hasAuto||after.auto_bezier===args.auto_bezier)&&(!hasContinuous||after.continuous===args.continuous);
        return {native_accepted:true,verification_status:verified?"verified_temporal_flag_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,key_index:index,key_time:expected,before:before,after:after};
    }
    function spatialVector(value,label,dimensions) {
        if(!(value instanceof Array)||value.length!==dimensions)fail(label+" must contain exactly "+dimensions+" finite values.");
        var out=[],i;
        for(i=0;i<value.length;i++){
            if(!finiteNumber(value[i])||Math.abs(value[i])>1000000)fail(label+" contains invalid or unbounded values.");
            out.push(value[i]);
        }
        return out;
    }
    function sameVector(a,b) {
        if(!(a instanceof Array)||!(b instanceof Array)||a.length!==b.length)return false;
        var i;for(i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>EPSILON)return false;
        return true;
    }
    function setKeyframeSpatial(args) {
        var resolved=resolveProperty(args.property),p=resolved.property,index=args.key_index,expected=args.expected_time_seconds;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>p.numKeys
            ||!finiteNumber(expected)||expected<0||expected>10800) {
            fail("set_keyframe_spatial requires valid key_index and expected_time_seconds.");
        }
        var keyTime=p.keyTime(index);
        if(Math.abs(keyTime-expected)>EPSILON)fail("Spatial keyframe time stale guard changed.");
        var type=p.propertyValueType;
        var dimensions=type===PropertyValueType.TwoD_SPATIAL?2:type===PropertyValueType.ThreeD_SPATIAL?3:0;
        if(dimensions===0)fail("Target property is not a TwoD_SPATIAL or ThreeD_SPATIAL property.");

        var hasTangents=args.in_tangent!==undefined||args.out_tangent!==undefined;
        var hasAuto=args.auto_bezier!==undefined,hasContinuous=args.continuous!==undefined,hasRoving=args.roving!==undefined;
        if(!hasTangents&&!hasAuto&&!hasContinuous&&!hasRoving)fail("set_keyframe_spatial requires at least one spatial field.");
        if(hasAuto&&typeof args.auto_bezier!=="boolean")fail("auto_bezier must be boolean.");
        if(hasContinuous&&typeof args.continuous!=="boolean")fail("continuous must be boolean.");
        if(hasRoving&&typeof args.roving!=="boolean")fail("roving must be boolean.");
        if(hasTangents&&args.auto_bezier===true)fail("Explicit spatial tangents cannot be combined with auto_bezier=true in one guarded mutation.");
        if(args.roving===true&&(index===1||index===p.numKeys))fail("First and last spatial keyframes cannot rove.");

        var requestedIn=null,requestedOut=null;
        if(hasTangents){
            var currentIn=cloneValue(p.keyInSpatialTangent(index)),currentOut=cloneValue(p.keyOutSpatialTangent(index));
            requestedIn=args.in_tangent===undefined?currentIn:spatialVector(args.in_tangent,"in_tangent",dimensions);
            requestedOut=args.out_tangent===undefined?currentOut:spatialVector(args.out_tangent,"out_tangent",dimensions);
        }
        var before={
            in_tangent:cloneValue(p.keyInSpatialTangent(index)),
            out_tangent:cloneValue(p.keyOutSpatialTangent(index)),
            auto_bezier:!!p.keySpatialAutoBezier(index),
            continuous:!!p.keySpatialContinuous(index),
            roving:!!p.keyRoving(index)
        };

        app.beginUndoGroup("Shuvi: Set spatial keyframe");
        try{
            if(hasTangents)p.setSpatialTangentsAtKey(index,requestedIn,requestedOut);
            if(hasContinuous)p.setSpatialContinuousAtKey(index,args.continuous);
            if(hasAuto)p.setSpatialAutoBezierAtKey(index,args.auto_bezier);
            if(hasRoving)p.setRovingAtKey(index,args.roving);
        }finally{app.endUndoGroup();}

        resolved=resolveProperty(args.property);p=resolved.property;
        if(index>p.numKeys||Math.abs(p.keyTime(index)-expected)>EPSILON)fail("Spatial keyframe identity changed during mutation.");
        var after={
            in_tangent:cloneValue(p.keyInSpatialTangent(index)),
            out_tangent:cloneValue(p.keyOutSpatialTangent(index)),
            auto_bezier:!!p.keySpatialAutoBezier(index),
            continuous:!!p.keySpatialContinuous(index),
            roving:!!p.keyRoving(index)
        };
        var verified=true;
        if(hasTangents&&(!sameVector(after.in_tangent,requestedIn)||!sameVector(after.out_tangent,requestedOut)))verified=false;
        if(hasAuto&&after.auto_bezier!==args.auto_bezier)verified=false;
        if(hasContinuous&&after.continuous!==args.continuous)verified=false;
        if(hasRoving&&after.roving!==args.roving)verified=false;
        return {native_accepted:true,verification_status:verified?"verified_spatial_keyframe_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,key_index:index,key_time:expected,dimensions:dimensions,before:before,after:after};
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
    function resolveAVItem(itemId) {
        var item=resolveItem(itemId);
        if(!(item instanceof FootageItem)&&!(item instanceof CompItem))fail("Target project item is not an AV item supported by this action.");
        return item;
    }
    function currentProxyFile(item) {
        if(!item.useProxy||!item.proxySource)return null;
        try{return item.proxySource.file?item.proxySource.file.fsName:null;}catch(ignore){return null;}
    }
    function relinkFootage(args) {
        var item=resolveItem(args.item_id);
        if(!(item instanceof FootageItem)||!item.file)fail("Relink requires file-backed FootageItem.");
        var expected=boundedString(args.expected_current_file,4096,"expected current footage file"),current=item.file.fsName;
        if(new File(expected).fsName!==current)fail("Footage source stale guard changed.");
        var nextPath=boundedString(args.new_file,4096,"new footage file"),next=new File(nextPath);
        if(!next.exists)fail("New footage source file does not exist.");
        app.beginUndoGroup("Shuvi: Relink footage");
        try{item.replace(next);}finally{app.endUndoGroup();}
        item=resolveItem(args.item_id);
        var actual=item instanceof FootageItem&&item.file?item.file.fsName:null,verified=actual===next.fsName;
        return {native_accepted:true,verification_status:verified?"verified_source_readback":"accepted_unverified",retry_safe:verified,
            item_id:item.id,before_file:current,after_file:actual};
    }
    function setProxy(args) {
        var item=resolveAVItem(args.item_id);
        if(typeof args.expected_use_proxy!=="boolean")fail("set_proxy requires expected_use_proxy stale guard.");
        if(!!item.useProxy!==args.expected_use_proxy)fail("Proxy enabled-state stale guard changed.");
        var before=currentProxyFile(item);
        if(args.expected_use_proxy){
            var expected=boundedString(args.expected_proxy_file,4096,"expected proxy file");
            if(!before||before!==new File(expected).fsName)fail("Proxy source stale guard changed.");
        }else if(args.expected_proxy_file!==undefined&&args.expected_proxy_file!==null){
            fail("expected_proxy_file must be null/omitted when expected_use_proxy=false.");
        }
        var nextPath=boundedString(args.proxy_file,4096,"proxy file"),next=new File(nextPath);
        if(!next.exists)fail("Proxy file does not exist.");
        app.beginUndoGroup("Shuvi: Set proxy");
        try{item.setProxy(next);}finally{app.endUndoGroup();}
        item=resolveAVItem(args.item_id);
        var after=currentProxyFile(item),verified=!!item.useProxy&&after===next.fsName;
        return {native_accepted:true,verification_status:verified?"verified_proxy_readback":"accepted_unverified",retry_safe:verified,
            item_id:item.id,before_use_proxy:args.expected_use_proxy,before_proxy_file:before,after_use_proxy:!!item.useProxy,after_proxy_file:after};
    }
    function removeProxy(args) {
        var item=resolveAVItem(args.item_id);
        if(!item.useProxy)fail("remove_proxy expected an active proxy.");
        var expected=boundedString(args.expected_proxy_file,4096,"expected proxy file"),before=currentProxyFile(item);
        if(!before||before!==new File(expected).fsName)fail("Proxy source stale guard changed.");
        app.beginUndoGroup("Shuvi: Remove proxy");
        try{item.setProxyToNone();}finally{app.endUndoGroup();}
        item=resolveAVItem(args.item_id);
        var verified=!item.useProxy&&item.proxySource===null;
        return {native_accepted:true,verification_status:verified?"verified_proxy_readback":"accepted_unverified",retry_safe:verified,
            item_id:item.id,before_proxy_file:before,after_use_proxy:!!item.useProxy};
    }
    function blendingModeEnum(name) {
        var values={
            normal:BlendingMode.NORMAL,add:BlendingMode.ADD,alpha_add:BlendingMode.ALPHA_ADD,
            multiply:BlendingMode.MULTIPLY,screen:BlendingMode.SCREEN,overlay:BlendingMode.OVERLAY,
            soft_light:BlendingMode.SOFT_LIGHT,hard_light:BlendingMode.HARD_LIGHT,darken:BlendingMode.DARKEN,
            lighten:BlendingMode.LIGHTEN,difference:BlendingMode.DIFFERENCE,exclusion:BlendingMode.EXCLUSION,
            color:BlendingMode.COLOR,hue:BlendingMode.HUE,saturation:BlendingMode.SATURATION,luminosity:BlendingMode.LUMINOSITY,
            color_dodge:BlendingMode.COLOR_DODGE,color_burn:BlendingMode.COLOR_BURN,linear_dodge:BlendingMode.LINEAR_DODGE,
            linear_burn:BlendingMode.LINEAR_BURN,linear_light:BlendingMode.LINEAR_LIGHT,vivid_light:BlendingMode.VIVID_LIGHT,
            pin_light:BlendingMode.PIN_LIGHT,hard_mix:BlendingMode.HARD_MIX,divide:BlendingMode.DIVIDE,subtract:BlendingMode.SUBTRACT
        };
        if(!values.hasOwnProperty(name))fail("Unsupported allowlisted blending mode.");
        return values[name];
    }
    function qualityEnum(name) {
        if(name==="best")return LayerQuality.BEST;
        if(name==="draft")return LayerQuality.DRAFT;
        if(name==="wireframe")return LayerQuality.WIREFRAME;
        fail("Unsupported layer quality.");
    }
    function samplingQualityEnum(name) {
        if(name==="bicubic")return LayerSamplingQuality.BICUBIC;
        if(name==="bilinear")return LayerSamplingQuality.BILINEAR;
        fail("Unsupported layer sampling quality.");
    }
    function frameBlendingEnum(name) {
        if(name==="frame_mix")return FrameBlendingType.FRAME_MIX;
        if(name==="pixel_motion")return FrameBlendingType.PIXEL_MOTION;
        if(name==="none")return FrameBlendingType.NO_FRAME_BLEND;
        fail("Unsupported frame blending type.");
    }
    function enumKey(map,value) {
        var key;for(key in map)if(map.hasOwnProperty(key)&&map[key]===value)return key;return null;
    }
    function avRenderingSnapshot(layer) {
        var blends={
            normal:BlendingMode.NORMAL,add:BlendingMode.ADD,alpha_add:BlendingMode.ALPHA_ADD,
            multiply:BlendingMode.MULTIPLY,screen:BlendingMode.SCREEN,overlay:BlendingMode.OVERLAY,
            soft_light:BlendingMode.SOFT_LIGHT,hard_light:BlendingMode.HARD_LIGHT,darken:BlendingMode.DARKEN,
            lighten:BlendingMode.LIGHTEN,difference:BlendingMode.DIFFERENCE,exclusion:BlendingMode.EXCLUSION,
            color:BlendingMode.COLOR,hue:BlendingMode.HUE,saturation:BlendingMode.SATURATION,luminosity:BlendingMode.LUMINOSITY,
            color_dodge:BlendingMode.COLOR_DODGE,color_burn:BlendingMode.COLOR_BURN,linear_dodge:BlendingMode.LINEAR_DODGE,
            linear_burn:BlendingMode.LINEAR_BURN,linear_light:BlendingMode.LINEAR_LIGHT,vivid_light:BlendingMode.VIVID_LIGHT,
            pin_light:BlendingMode.PIN_LIGHT,hard_mix:BlendingMode.HARD_MIX,divide:BlendingMode.DIVIDE,subtract:BlendingMode.SUBTRACT
        };
        var qualities={best:LayerQuality.BEST,draft:LayerQuality.DRAFT,wireframe:LayerQuality.WIREFRAME};
        var samples={bicubic:LayerSamplingQuality.BICUBIC,bilinear:LayerSamplingQuality.BILINEAR};
        var frames={frame_mix:FrameBlendingType.FRAME_MIX,pixel_motion:FrameBlendingType.PIXEL_MOTION,none:FrameBlendingType.NO_FRAME_BLEND};
        return {
            blending_mode:enumKey(blends,layer.blendingMode),
            quality:enumKey(qualities,layer.quality),
            sampling_quality:enumKey(samples,layer.samplingQuality),
            has_audio:!!layer.hasAudio,
            audio_enabled:!!layer.audioEnabled,
            guide_layer:!!layer.guideLayer,
            frame_blending:!!layer.frameBlending,
            frame_blending_type:enumKey(frames,layer.frameBlendingType)
        };
    }
    function inspectAVLayerRendering(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        if(!(layer instanceof AVLayer))fail("Target layer is not an AVLayer.");
        return {verification_status:"verified_readback",comp_id:comp.id,layer_id:layer.id,rendering:avRenderingSnapshot(layer)};
    }
    function setAVLayerRendering(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        if(!(layer instanceof AVLayer))fail("Target layer is not an AVLayer.");
        if(layer.locked)fail("Layer is locked; AV rendering mutation refused.");
        var requested={},count=0;
        if(args.blending_mode!==undefined){requested.blendingMode=blendingModeEnum(boundedString(args.blending_mode,32,"blending mode"));count++;}
        if(args.quality!==undefined){requested.quality=qualityEnum(boundedString(args.quality,16,"quality"));count++;}
        if(args.sampling_quality!==undefined){requested.samplingQuality=samplingQualityEnum(boundedString(args.sampling_quality,16,"sampling quality"));count++;}
        if(args.audio_enabled!==undefined){
            if(typeof args.audio_enabled!=="boolean")fail("audio_enabled must be boolean.");
            if(args.audio_enabled&& !layer.hasAudio)fail("Cannot enable audio on a layer without audio.");
            requested.audioEnabled=args.audio_enabled;count++;
        }
        if(args.guide_layer!==undefined){if(typeof args.guide_layer!=="boolean")fail("guide_layer must be boolean.");requested.guideLayer=args.guide_layer;count++;}
        if(args.frame_blending_type!==undefined){requested.frameBlendingType=frameBlendingEnum(boundedString(args.frame_blending_type,24,"frame blending type"));count++;}
        if(count===0)fail("set_av_layer_rendering requires at least one requested field.");
        var before=avRenderingSnapshot(layer);

        app.beginUndoGroup("Shuvi: Set AV layer rendering");
        try{
            if(requested.blendingMode!==undefined)layer.blendingMode=requested.blendingMode;
            if(requested.quality!==undefined)layer.quality=requested.quality;
            if(requested.samplingQuality!==undefined)layer.samplingQuality=requested.samplingQuality;
            if(requested.audioEnabled!==undefined)layer.audioEnabled=requested.audioEnabled;
            if(requested.guideLayer!==undefined)layer.guideLayer=requested.guideLayer;
            if(requested.frameBlendingType!==undefined)layer.frameBlendingType=requested.frameBlendingType;
        }finally{app.endUndoGroup();}

        layer=resolveLayer(comp,args.layer_id);
        var verified=true,key;
        for(key in requested)if(requested.hasOwnProperty(key)&&layer[key]!==requested[key])verified=false;
        var after=avRenderingSnapshot(layer);
        return {native_accepted:true,verification_status:verified?"verified_av_rendering_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before:before,after:after};
    }
    function setAVLayerFlags(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id);
        if(!(layer instanceof AVLayer))fail("Target layer is not an AVLayer.");
        if(layer.locked)fail("Layer is locked; AV flag mutation refused.");
        var requested={},count=0;
        function add(name,key){
            if(args[key]!==undefined){if(typeof args[key]!=="boolean")fail(key+" must be boolean.");requested[name]=args[key];count++;}
        }
        add("threeDLayer","three_d_layer");add("adjustmentLayer","adjustment_layer");add("collapseTransformation","collapse_transformation");
        add("motionBlur","motion_blur");add("preserveTransparency","preserve_transparency");
        if(count===0)fail("set_av_layer_flags requires at least one requested switch.");
        var before={three_d_layer:!!layer.threeDLayer,adjustment_layer:!!layer.adjustmentLayer,collapse_transformation:!!layer.collapseTransformation,
            motion_blur:!!layer.motionBlur,preserve_transparency:!!layer.preserveTransparency};
        app.beginUndoGroup("Shuvi: Set AV layer flags");
        try{
            if(requested.threeDLayer!==undefined)layer.threeDLayer=requested.threeDLayer;
            if(requested.adjustmentLayer!==undefined)layer.adjustmentLayer=requested.adjustmentLayer;
            if(requested.collapseTransformation!==undefined)layer.collapseTransformation=requested.collapseTransformation;
            if(requested.motionBlur!==undefined)layer.motionBlur=requested.motionBlur;
            if(requested.preserveTransparency!==undefined)layer.preserveTransparency=requested.preserveTransparency;
        }finally{app.endUndoGroup();}
        layer=resolveLayer(comp,args.layer_id);
        var verified=true,k;for(k in requested)if(requested.hasOwnProperty(k)&&!!layer[k]!==requested[k])verified=false;
        return {native_accepted:true,verification_status:verified?"verified_layer_flag_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:layer.id,before:before,
            after:{three_d_layer:!!layer.threeDLayer,adjustment_layer:!!layer.adjustmentLayer,collapse_transformation:!!layer.collapseTransformation,
                motion_blur:!!layer.motionBlur,preserve_transparency:!!layer.preserveTransparency}};
    }
    function mogrtControllerInventory(comp) {
        var count=comp.motionGraphicsTemplateControllerCount;
        if(count>256)fail("Essential Graphics controller inventory exceeds mutation safety bound.");
        var names=[],i;
        for(i=1;i<=count;i++)names.push(String(comp.getMotionGraphicsTemplateControllerName(i)).slice(0,240));
        return names;
    }
    function stringInventoryAddedOnce(before,after,name) {
        if(after.length!==before.length+1)return false;
        var counts={},i,key;
        for(i=0;i<before.length;i++){key="$"+before[i];counts[key]=(counts[key]||0)+1;}
        for(i=0;i<after.length;i++){key="$"+after[i];counts[key]=(counts[key]||0)-1;}
        for(key in counts)if(counts.hasOwnProperty(key)&&counts[key]!==0){
            if(key==="$"+name&&counts[key]===-1){counts[key]=0;continue;}
            return false;
        }
        return true;
    }
    function inspectMogrt(args) {
        var comp=resolveComp(args.comp_id),count=comp.motionGraphicsTemplateControllerCount,limit=Math.min(count,256),names=[],i;
        for(i=1;i<=limit;i++)names.push(String(comp.getMotionGraphicsTemplateControllerName(i)).slice(0,240));
        return {verification_status:"verified_readback",comp_id:comp.id,template_name:String(comp.motionGraphicsTemplateName||"").slice(0,240),
            controller_count:count,scan_truncated:count>256,controller_names:names};
    }
    function safeControllerName(value) {
        var name=boundedString(value,120,"Essential Graphics controller name");
        if(/[\x00-\x1F\x7F]/.test(name))fail("Essential Graphics controller name contains control characters.");
        return name;
    }
    function addMogrtProperty(args) {
        var resolved=resolveProperty(args.property),comp=resolved.comp,p=resolved.property,name=safeControllerName(args.controller_name);
        if(typeof p.canAddToMotionGraphicsTemplate!=="function"||typeof p.addToMotionGraphicsTemplateAs!=="function")
            fail("Current After Effects host does not expose Essential Graphics property authoring.");
        if(!p.canAddToMotionGraphicsTemplate(comp))fail("Property cannot be added to this Essential Graphics template or is already present.");
        var before=mogrtControllerInventory(comp);
        app.beginUndoGroup("Shuvi: Add Essential Graphics property");
        var accepted=false;
        try{accepted=!!p.addToMotionGraphicsTemplateAs(comp,name);}finally{app.endUndoGroup();}
        var after=mogrtControllerInventory(comp),verified=accepted&&stringInventoryAddedOnce(before,after,name);
        return {native_accepted:accepted,verification_status:verified?"verified_mogrt_controller_delta":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:resolved.layer.id,controller_name:name,before_count:before.length,after_count:after.length};
    }
    function addMogrtMediaLayer(args) {
        var comp=resolveComp(args.comp_id),layer=resolveLayer(comp,args.layer_id),name=safeControllerName(args.controller_name);
        if(!(layer instanceof AVLayer))fail("MOGRT media replacement controller requires an AVLayer.");
        if(typeof layer.canAddToMotionGraphicsTemplate!=="function"||typeof layer.addToMotionGraphicsTemplateAs!=="function")
            fail("Current After Effects host does not expose Essential Graphics media authoring.");
        if(!layer.canAddToMotionGraphicsTemplate(comp))fail("Layer cannot be added as media replacement or is already present.");
        var before=mogrtControllerInventory(comp);
        app.beginUndoGroup("Shuvi: Add Essential Graphics media");
        var accepted=false;
        try{accepted=!!layer.addToMotionGraphicsTemplateAs(comp,name);}finally{app.endUndoGroup();}
        var after=mogrtControllerInventory(comp),verified=accepted&&stringInventoryAddedOnce(before,after,name);
        return {native_accepted:accepted,verification_status:verified?"verified_mogrt_controller_delta":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:layer.id,controller_name:name,before_count:before.length,after_count:after.length};
    }
    function absoluteMogrtFile(value) {
        var path=boundedString(value,4096,"MOGRT output file");
        if(!/^([A-Za-z]:[\\\/]|\\\\|\/)/.test(path))fail("MOGRT output_file must be absolute.");
        if(!/\.mogrt$/i.test(path))fail("MOGRT output_file must end in .mogrt.");
        var file=new File(path);
        if(!file.parent||!file.parent.exists)fail("MOGRT output parent folder does not exist.");
        return file;
    }
    function exportMogrt(args) {
        var comp=resolveComp(args.comp_id),file=absoluteMogrtFile(args.output_file),overwrite=args.overwrite===true;
        var base=decodeURI(String(file.name)).replace(/\.mogrt$/i,"");
        if(base.length<1||base.length>120||/[<>:"\\\/|?*]/.test(base)||/[\. ]$/.test(base))
            fail("MOGRT filename is not a safe template name.");
        if(file.exists&&!overwrite)fail("MOGRT output already exists; explicit overwrite=true required.");
        if(!requireProject().file)fail("After Effects project must already have an exact saved path before MOGRT export.");
        var beforeExists=file.exists,beforeLength=beforeExists?file.length:null;
        comp.motionGraphicsTemplateName=base;
        if(String(comp.motionGraphicsTemplateName)!==base)fail("MOGRT template name readback failed.");
        app.project.save();
        var accepted=!!comp.exportAsMotionGraphicsTemplate(overwrite,file.parent.fsName);
        var after=new File(file.fsName);
        var verified=accepted&&after.exists&&after.length>0;
        return {native_accepted:accepted,verification_status:verified?"verified_mogrt_file_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,template_name:base,output_file:after.fsName,output_exists:after.exists,size_bytes:after.exists?after.length:null,
            output_existed_before:beforeExists,before_size_bytes:beforeLength,project_save_requested:true,desktop_file_verification_required:true};
    }
    function validateGroundedTrackSamples(samples) {
        if(!(samples instanceof Array)||samples.length<1||samples.length>10000)fail("Hand-track rig requires 1..10000 grounded samples.");
        var times=[],values=[],dimension=null,previous=-1,i,j;
        for(i=0;i<samples.length;i++){
            var sample=samples[i];
            if(!sample||!finiteNumber(sample.time_seconds)||sample.time_seconds<0||sample.time_seconds>10800||sample.time_seconds<=previous)
                fail("Hand-track sample times must be finite and strictly increasing.");
            if(!(sample.point instanceof Array)||(sample.point.length!==2&&sample.point.length!==3))
                fail("Hand-track points must be 2D or 3D arrays.");
            if(dimension===null)dimension=sample.point.length;
            if(sample.point.length!==dimension)fail("Hand-track point dimensions must remain consistent.");
            var point=[];
            for(j=0;j<sample.point.length;j++){
                if(!finiteNumber(sample.point[j])||Math.abs(sample.point[j])>1000000)fail("Hand-track point contains invalid or unbounded coordinate.");
                point.push(sample.point[j]);
            }
            if(sample.confidence!==undefined&&(!finiteNumber(sample.confidence)||sample.confidence<0||sample.confidence>1))
                fail("Hand-track confidence must be 0..1 when provided.");
            times.push(sample.time_seconds);values.push(point);previous=sample.time_seconds;
        }
        return {times:times,values:values,dimension:dimension};
    }
    function essentialGroup(comp,layerId) {
        var layer=resolveLayer(comp,layerId);
        var group=layer.property("ADBE Layer Overrides");
        if(!group)fail("Target layer has no Essential Properties group.");
        if(group.numProperties>256)fail("Essential Properties group exceeds 256-property safety bound.");
        return {layer:layer,group:group};
    }
    function essentialEntry(prop,index) {
        var alternate=null,source=null,value=null;
        try{alternate=prop.alternateSource;}catch(ignoreAlternate){}
        try{source=prop.essentialPropertySource;}catch(ignoreSource){}
        try{value=cloneValue(prop.value);}catch(ignoreValue){}
        var sourceInfo=null;
        if(source){
            if(source instanceof AVLayer)sourceInfo={kind:"media_layer",layer_id:source.id,name:String(source.name).slice(0,240)};
            else sourceInfo={kind:"property",match_name:String(source.matchName||""),property_index:source.propertyIndex===undefined?null:source.propertyIndex,
                name:String(source.name||"").slice(0,240)};
        }
        return {essential_index:index,name:String(prop.name).slice(0,240),match_name:String(prop.matchName||""),
            property_index:prop.propertyIndex===undefined?null:prop.propertyIndex,property_value_type:prop.propertyValueType===undefined?null:String(prop.propertyValueType),
            num_keys:prop.numKeys===undefined?null:prop.numKeys,can_set_alternate_source:!!prop.canSetAlternateSource,
            alternate_source_item_id:alternate&&alternate.id?alternate.id:null,alternate_source_name:alternate?String(alternate.name).slice(0,240):null,
            essential_source:sourceInfo,value:value};
    }
    function inspectEssentialProperties(args) {
        var comp=resolveComp(args.comp_id),resolved=essentialGroup(comp,args.layer_id),items=[],i;
        for(i=1;i<=resolved.group.numProperties;i++)items.push(essentialEntry(resolved.group.property(i),i));
        return {verification_status:"verified_readback",comp_id:comp.id,layer_id:resolved.layer.id,
            essential_property_count:resolved.group.numProperties,scan_truncated:false,properties:items};
    }
    function resolveEssential(args) {
        var comp=resolveComp(args.comp_id),resolved=essentialGroup(comp,args.layer_id),index=args.essential_index;
        if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>resolved.group.numProperties)
            fail("Invalid essential_index.");
        var prop=resolved.group.property(index);
        if(!prop)fail("Essential Property is unavailable.");
        var expected=boundedString(args.expected_name,240,"expected Essential Property name");
        if(String(prop.name)!==expected)fail("Essential Property name stale guard changed.");
        return {comp:comp,layer:resolved.layer,group:resolved.group,property:prop,index:index};
    }
    function setEssentialProperty(args) {
        var resolved=resolveEssential(args),p=resolved.property;
        if(p.canSetAlternateSource)fail("Media Replacement Essential Properties must use set_essential_media_source.");
        if(p.numKeys!==undefined&&p.numKeys>0)fail("Static Essential Property write refused because keyframes already exist.");
        if(typeof p.setValue!=="function")fail("Essential Property is not directly writable.");
        var requested=cloneValue(args.value),before=essentialEntry(p,resolved.index);
        app.beginUndoGroup("Shuvi: Set Essential Property");
        try{p.setValue(requested);}finally{app.endUndoGroup();}
        resolved=resolveEssential(args);p=resolved.property;
        var after=essentialEntry(p,resolved.index),verified=sameValue(after.value,requested);
        return {native_accepted:true,verification_status:verified?"verified_essential_property_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,essential_index:resolved.index,essential_name:String(p.name),before:before,after:after};
    }
    function setEssentialMediaSource(args) {
        var resolved=resolveEssential(args),p=resolved.property;
        if(!p.canSetAlternateSource||typeof p.setAlternateSource!=="function")
            fail("Essential Property does not support Media Replacement.");
        if(!args.hasOwnProperty("expected_alternate_source_item_id"))
            fail("Media Replacement requires expected_alternate_source_item_id stale guard, using null when unset.");
        var beforeSource=null;try{beforeSource=p.alternateSource;}catch(ignore){}
        var beforeId=beforeSource&&beforeSource.id?beforeSource.id:null;
        var expected=args.expected_alternate_source_item_id;
        if(expected!==null&&(!finiteNumber(expected)||Math.floor(expected)!==expected||expected<1))
            fail("expected_alternate_source_item_id must be null or a positive item ID.");
        if(beforeId!==expected)fail("Essential media alternate-source stale guard changed.");
        var source=resolveItem(args.source_item_id);
        if(source.isMediaReplacementCompatible!==true)fail("Requested source item is not Media Replacement compatible.");
        app.beginUndoGroup("Shuvi: Set Essential Media Source");
        try{p.setAlternateSource(source);}finally{app.endUndoGroup();}
        resolved=resolveEssential(args);p=resolved.property;
        var afterSource=p.alternateSource,afterId=afterSource&&afterSource.id?afterSource.id:null,verified=afterId===source.id;
        return {native_accepted:true,verification_status:verified?"verified_essential_media_readback":"accepted_unverified",retry_safe:verified,
            comp_id:resolved.comp.id,layer_id:resolved.layer.id,essential_index:resolved.index,essential_name:String(p.name),
            before_source_item_id:beforeId,after_source_item_id:afterId,requested_source_item_id:source.id};
    }
    function applyEssentialBindings(args) {
        var comp=resolveComp(args.comp_id),resolved=essentialGroup(comp,args.layer_id),bindings=args.bindings;
        if(!(bindings instanceof Array)||bindings.length<1||bindings.length>64)
            fail("apply_essential_bindings requires 1..64 bindings.");
        var plans=[],seen={},i;
        for(i=0;i<bindings.length;i++){
            var binding=bindings[i],index=binding.essential_index;
            if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>resolved.group.numProperties)
                fail("Essential binding has invalid essential_index.");
            if(seen[index])fail("Essential binding indexes must be unique.");
            seen[index]=true;
            var p=resolved.group.property(index),expected=boundedString(binding.expected_name,240,"expected Essential Property name");
            if(String(p.name)!==expected)fail("Essential binding name stale guard changed.");
            var hasValue=binding.hasOwnProperty("value"),hasSource=binding.hasOwnProperty("source_item_id");
            if(hasValue===hasSource)fail("Each Essential binding must provide exactly one of value or source_item_id.");
            if(hasSource){
                if(!p.canSetAlternateSource||typeof p.setAlternateSource!=="function")
                    fail("Essential media binding does not support Media Replacement.");
                if(!binding.hasOwnProperty("expected_alternate_source_item_id"))
                    fail("Essential media binding requires expected_alternate_source_item_id.");
                var current=null;try{current=p.alternateSource;}catch(ignoreCurrent){}
                var currentId=current&&current.id?current.id:null,expectedAlt=binding.expected_alternate_source_item_id;
                if(expectedAlt!==null&&(!finiteNumber(expectedAlt)||Math.floor(expectedAlt)!==expectedAlt||expectedAlt<1))
                    fail("Essential media expected alternate source must be null or positive item ID.");
                if(currentId!==expectedAlt)fail("Essential media binding alternate-source stale guard changed.");
                var source=resolveItem(binding.source_item_id);
                if(source.isMediaReplacementCompatible!==true)fail("Essential media binding source is not Media Replacement compatible.");
                plans.push({kind:"media",index:index,name:expected,property:p,source:source,before_item_id:currentId});
            }else{
                if(p.canSetAlternateSource)fail("Media Replacement Essential Property requires source_item_id binding.");
                if(p.numKeys!==undefined&&p.numKeys>0)fail("Batch static Essential Property write refused because keyframes already exist.");
                if(typeof p.setValue!=="function")fail("Batch Essential Property is not directly writable.");
                plans.push({kind:"value",index:index,name:expected,property:p,value:cloneValue(binding.value),
                    before:essentialEntry(p,index)});
            }
        }

        app.beginUndoGroup("Shuvi: Apply Essential Bindings");
        try{
            for(i=0;i<plans.length;i++){
                if(plans[i].kind==="media")plans[i].property.setAlternateSource(plans[i].source);
                else plans[i].property.setValue(plans[i].value);
            }
        }finally{app.endUndoGroup();}

        resolved=essentialGroup(comp,args.layer_id);
        var results=[],verified=true;
        for(i=0;i<plans.length;i++){
            var plan=plans[i],prop=resolved.group.property(plan.index);
            if(!prop||String(prop.name)!==plan.name){verified=false;results.push({essential_index:plan.index,verified:false,reason:"identity_changed"});continue;}
            if(plan.kind==="media"){
                var afterSource=prop.alternateSource,afterId=afterSource&&afterSource.id?afterSource.id:null,ok=afterId===plan.source.id;
                if(!ok)verified=false;
                results.push({essential_index:plan.index,name:plan.name,kind:"media",before_source_item_id:plan.before_item_id,
                    requested_source_item_id:plan.source.id,after_source_item_id:afterId,verified:ok});
            }else{
                var afterValue=null;try{afterValue=cloneValue(prop.value);}catch(ignoreValue){}
                var okValue=sameValue(afterValue,plan.value);if(!okValue)verified=false;
                results.push({essential_index:plan.index,name:plan.name,kind:"value",requested_value:plan.value,after_value:afterValue,verified:okValue});
            }
        }
        return {native_accepted:true,verification_status:verified?"verified_essential_binding_batch":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:resolved.layer.id,binding_count:plans.length,results:results};
    }
    function applyHandTrackRig(args) {
        var comp=resolveComp(args.comp_id);
        if(args.coordinate_space!==undefined&&args.coordinate_space!=="comp_pixels")
            fail("apply_hand_track_rig currently requires coordinate_space=comp_pixels.");
        var track=validateGroundedTrackSamples(args.samples);
        var target=null;
        if(args.target_layer_id!==undefined&&args.target_layer_id!==null){
            target=resolveLayer(comp,args.target_layer_id);
            if(target.locked)fail("Target layer is locked; hand-track parenting refused.");
        }
        var name=args.name===undefined?"Shuvi Hand Track":boundedString(args.name,120,"tracking null name");
        var beforeLayers=comp.numLayers;
        app.beginUndoGroup("Shuvi: Apply hand track rig");
        var nullLayer=null,parentAssigned=false;
        try{
            nullLayer=comp.layers.addNull();
            nullLayer.name=name;
            if(track.dimension===3)nullLayer.threeDLayer=true;
            var position=nullLayer.property("ADBE Transform Group").property("ADBE Position");
            if(!position||!position.canVaryOverTime||typeof position.setValuesAtTimes!=="function")fail("Tracking null position cannot accept keyframes.");
            position.setValuesAtTimes(track.times,track.values);
            if(target){
                if(args.preserve_visual===false)target.setParentWithJump(nullLayer);
                else target.parent=nullLayer;
                parentAssigned=true;
            }
        }finally{app.endUndoGroup();}

        var created=resolveLayer(comp,nullLayer.id);
        var readPosition=created.property("ADBE Transform Group").property("ADBE Position");
        var verified=comp.numLayers===beforeLayers+1&&readPosition.numKeys===track.times.length;
        var i;
        for(i=0;i<track.times.length&&verified;i++){
            if(!sameValue(cloneValue(readPosition.valueAtTime(track.times[i],true)),track.values[i]))verified=false;
        }
        var parentVerified=true;
        if(target){
            target=resolveLayer(comp,args.target_layer_id);
            parentVerified=!!target.parent&&target.parent.id===created.id;
            if(!parentVerified)verified=false;
        }
        return {native_accepted:true,verification_status:verified?"verified_hand_track_rig_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,tracking_layer_id:created.id,target_layer_id:target?target.id:null,target_parented:parentAssigned&&parentVerified,
            preserve_visual:args.preserve_visual!==false,sample_count:track.times.length,dimensions:track.dimension,
            coordinate_space:"comp_pixels",native_hand_detection_claimed:false,before_layer_count:beforeLayers,after_layer_count:comp.numLayers};
    }
    function audioLevelsProperty(comp,layerId) {
        var layer=resolveLayer(comp,layerId);
        if(!(layer instanceof AVLayer)||!layer.hasAudio)fail("Target layer has no audio component.");
        var group=layer.property("ADBE Audio Group"),p=group?group.property("ADBE Audio Levels"):null;
        if(!p||!p.canVaryOverTime)fail("Audio Levels property is unavailable or non-animatable.");
        return {layer:layer,property:p};
    }
    function validateAudioDb(p,value,label) {
        if(!finiteNumber(value)||Math.abs(value)>1000)fail(label+" must be a finite bounded dB value.");
        try{if(p.hasMin&&value<p.minValue-EPSILON)fail(label+" is below the host Audio Levels minimum.");}catch(ignoreMin){}
        try{if(p.hasMax&&value>p.maxValue+EPSILON)fail(label+" is above the host Audio Levels maximum.");}catch(ignoreMax){}
        return value;
    }
    function inspectAudioLevels(args) {
        var comp=resolveComp(args.comp_id),resolved=audioLevelsProperty(comp,args.layer_id),p=resolved.property;
        var keys=[],limit=Math.min(p.numKeys,512),i;
        for(i=1;i<=limit;i++)keys.push({key_index:i,time_seconds:p.keyTime(i),value_db:cloneValue(p.keyValue(i))});
        return {verification_status:"verified_readback",comp_id:comp.id,layer_id:resolved.layer.id,
            audio_enabled:!!resolved.layer.audioEnabled,current_value_db:cloneValue(p.value),num_keys:p.numKeys,
            scan_truncated:p.numKeys>512,keyframes:keys};
    }
    function setAudioGain(args) {
        var comp=resolveComp(args.comp_id),resolved=audioLevelsProperty(comp,args.layer_id),p=resolved.property;
        if(p.numKeys!==0)fail("Static audio gain refused because Audio Levels already has keyframes.");
        var left=validateAudioDb(p,args.left_db,"left_db"),right=args.right_db===undefined?left:validateAudioDb(p,args.right_db,"right_db");
        var requested=[left,right],before=cloneValue(p.value);
        app.beginUndoGroup("Shuvi: Set audio gain");
        try{p.setValue(requested);}finally{app.endUndoGroup();}
        resolved=audioLevelsProperty(comp,args.layer_id);p=resolved.property;
        var after=cloneValue(p.value),verified=sameValue(after,requested);
        return {native_accepted:true,verification_status:verified?"verified_audio_gain_readback":"accepted_unverified",retry_safe:verified,
            comp_id:comp.id,layer_id:resolved.layer.id,before_db:before,after_db:after};
    }
    function applyAudioEnvelope(args) {
        var comp=resolveComp(args.comp_id),resolved=audioLevelsProperty(comp,args.layer_id),p=resolved.property,points=args.points;
        if(p.numKeys!==0)fail("Audio envelope requires zero existing Audio Levels keyframes.");
        if(!(points instanceof Array)||points.length<2||points.length>512)fail("Audio envelope requires 2..512 points.");
        var times=[],values=[],previous=-1,i;
        for(i=0;i<points.length;i++){
            var point=points[i],time=point.time_seconds;
            if(!finiteNumber(time)||time<0||time>10800||time<=previous)fail("Audio envelope times must be finite and strictly increasing.");
            var left=validateAudioDb(p,point.left_db,"left_db"),right=point.right_db===undefined?left:validateAudioDb(p,point.right_db,"right_db");
            times.push(time);values.push([left,right]);previous=time;
        }
        app.beginUndoGroup("Shuvi: Apply audio envelope");
        try{p.setValuesAtTimes(times,values);}finally{app.endUndoGroup();}
        resolved=audioLevelsProperty(comp,args.layer_id);p=resolved.property;
        var verified=p.numKeys===times.length;
        for(i=0;i<times.length&&verified;i++){
            if(!sameValue(cloneValue(p.valueAtTime(times[i],true)),values[i]))verified=false;
        }
        return {native_accepted:true,verification_status:verified?"verified_audio_envelope_readback":"accepted_unverified",retry_safe:false,
            comp_id:comp.id,layer_id:resolved.layer.id,point_count:times.length,start_seconds:times[0],end_seconds:times[times.length-1]};
    }
    function layerInputStageName(p,value) {
        var t=p.LayerInputStageType;
        if(!t)fail("Current After Effects host does not expose LayerInputStageType.");
        if(value===t.SOURCE)return "source";
        if(value===t.ONLY_MASKS)return "only_masks";
        if(value===t.ALL_EFFECTS)return "all_effects";
        return "unknown";
    }
    function layerInputStageValue(p,name) {
        var t=p.LayerInputStageType;
        if(!t)fail("Current After Effects host does not expose LayerInputStageType.");
        if(name==="source")return t.SOURCE;
        if(name==="only_masks")return t.ONLY_MASKS;
        if(name==="all_effects")return t.ALL_EFFECTS;
        fail("Layer input stage must be source, only_masks or all_effects.");
    }
    function layerInputStageRank(name) {
        if(name==="source")return 0;
        if(name==="only_masks")return 1;
        if(name==="all_effects")return 2;
        return -1;
    }
    function layerInputSnapshot(args) {
        var resolved=resolveProperty(args.property),p=resolved.property;
        if(p.propertyValueType!==PropertyValueType.LAYER_INDEX)fail("Target property is not a layer-input parameter.");
        if(typeof p.getInputStageCycleSafeLimit!=="function"||typeof p.setLayerInputStage!=="function")
            fail("Current After Effects host does not expose 26.5 layer-input stage scripting.");
        var pair=p.inputLayerAndStage;
        if(!(pair instanceof Array)||pair.length!==2)fail("Layer input/stage readback is unavailable.");
        var index=pair[0],source=null;
        if(index!==0){
            if(index<1||index>resolved.comp.numLayers)fail("Layer input index is outside target composition.");
            source=resolved.comp.layer(index);
        }
        var stage=layerInputStageName(p,pair[1]),limit=layerInputStageName(p,p.getInputStageCycleSafeLimit());
        return {resolved:resolved,property:p,source_layer_id:source?source.id:null,source_layer_index:index,
            stage:stage,cycle_safe_limit:limit};
    }
    function inspectLayerInputStage(args) {
        var snap=layerInputSnapshot(args);
        return {verification_status:"verified_readback",comp_id:snap.resolved.comp.id,layer_id:snap.resolved.layer.id,
            source_layer_id:snap.source_layer_id,source_layer_index:snap.source_layer_index,stage:snap.stage,cycle_safe_limit:snap.cycle_safe_limit};
    }
    function setLayerInputStage(args) {
        var snap=layerInputSnapshot(args);
        if(!args.hasOwnProperty("expected_source_layer_id"))fail("Layer input stage mutation requires expected_source_layer_id stale guard.");
        if(snap.source_layer_id!==args.expected_source_layer_id)fail("Layer input source stale guard changed.");
        var expectedStage=boundedString(args.expected_stage,24,"expected layer input stage");
        if(snap.stage!==expectedStage)fail("Layer input stage stale guard changed.");
        var requestedName=boundedString(args.stage,24,"layer input stage"),requested=layerInputStageValue(snap.property,requestedName);
        if(requestedName!=="source"&&layerInputStageRank(requestedName)>layerInputStageRank(snap.cycle_safe_limit))
            fail("Requested layer input stage exceeds current cycle-safe limit.");
        app.beginUndoGroup("Shuvi: Set layer input stage");
        try{snap.property.setLayerInputStage(requested);}finally{app.endUndoGroup();}
        var after=layerInputSnapshot(args),verified=after.source_layer_id===snap.source_layer_id&&after.stage===requestedName;
        return {native_accepted:true,verification_status:verified?"verified_layer_input_stage_readback":"accepted_unverified",retry_safe:verified,
            comp_id:after.resolved.comp.id,layer_id:after.resolved.layer.id,source_layer_id:after.source_layer_id,
            before_stage:snap.stage,after_stage:after.stage,cycle_safe_limit_after:after.cycle_safe_limit};
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
    function singleFileRenderPath(path) {
        boundedString(path,4096,"render output file");
        if(path.indexOf("[")>=0||path.indexOf("]")>=0)fail("Image-sequence output patterns are not supported by verified render_queue.");
        var lower=path.toLowerCase();
        var allowed=[".mov",".mp4",".m4v",".avi",".wav",".aif",".aiff",".mxf"],i;
        for(i=0;i<allowed.length;i++)if(lower.length>allowed[i].length&&lower.slice(-allowed[i].length)===allowed[i])return new File(path);
        fail("Verified render_queue currently requires a supported single-file media extension.");
    }
    function renderQueue(args) {
        var queue=requireProject().renderQueue;
        if(queue.rendering)fail("After Effects render queue is already rendering.");
        if(!(args.items instanceof Array)||args.items.length<1||args.items.length>64)fail("render_queue requires 1..64 exact expected items.");
        var overwrite=args.overwrite===true,expected={},before=[],i;
        for(i=0;i<args.items.length;i++){
            var spec=args.items[i],index=spec.queue_index;
            if(!finiteNumber(index)||Math.floor(index)!==index||index<1||index>queue.numItems||expected[index])fail("Invalid or duplicate render queue index.");
            var item=queue.item(index);
            if(!item||!item.comp||item.comp.id!==spec.comp_id)fail("Render queue comp identity stale guard changed.");
            if(!item.render||item.status!==RQItemStatus.QUEUED)fail("Expected render item is not currently queued.");
            if(item.numOutputModules!==1)fail("Verified render_queue currently requires exactly one output module per item.");
            var om=item.outputModule(1),file=singleFileRenderPath(spec.output_file);
            if(!om.file||om.file.fsName!==file.fsName)fail("Render output path stale guard changed.");
            if(file.exists&&!overwrite)fail("Render output already exists; explicit overwrite=true required.");
            var modified=file.exists&&file.modified?file.modified.getTime():null;
            before.push({queue_index:index,comp_id:item.comp.id,output_file:file.fsName,existed:file.exists,
                size_bytes:file.exists?file.length:null,modified_ms:modified});
            expected[index]=true;
        }
        var queuedCount=0;
        for(i=1;i<=queue.numItems;i++)if(queue.item(i).render){
            queuedCount++;if(!expected[i])fail("An unlisted render-enabled queue item would also render; mutation refused.");
        }
        if(queuedCount!==args.items.length)fail("Exact render-enabled queue set does not match expectation.");
        queue.render();
        var outputs=[],verified=!queue.rendering;
        for(i=0;i<before.length;i++){
            var b=before[i],item=queue.item(b.queue_index),om=item.outputModule(1),file=om.file;
            var exists=!!file&&file.exists,size=exists?file.length:null,modified=exists&&file.modified?file.modified.getTime():null;
            var changed=!b.existed||(size!==b.size_bytes)||(modified!==null&&b.modified_ms!==null&&modified>b.modified_ms);
            var done=item.status===RQItemStatus.DONE;
            if(!done||!exists||!(size>0)||!changed)verified=false;
            outputs.push({queue_index:b.queue_index,comp_id:item.comp?item.comp.id:null,status:String(item.status),
                done:done,output_file:file?file.fsName:null,size_bytes:size,modified_ms:modified,
                preexisting_output:b.existed,output_changed:changed});
        }
        return {native_accepted:true,verification_status:verified?"verified_render_completion":"accepted_unverified",retry_safe:false,
            render_completion_verified:verified,media_parse_verified:false,queue_rendering_after:!!queue.rendering,outputs:outputs};
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
            || action === "add_camera" || action === "add_light" || action === "create_comp" || action === "set_comp_settings" || action === "import_footage" || action === "add_item_layer"
            || action === "create_project_folder" || action === "set_project_item_state" || action === "remove_project_item"
            || action === "set_layer_state" || action === "set_layer_parent"
            || action === "move_layer" || action === "set_track_matte" || action === "remove_track_matte"
            || action === "set_time_remap" || action === "replace_source" || action === "relink_footage" || action === "set_proxy" || action === "remove_proxy"
            || action === "set_av_layer_flags" || action === "set_av_layer_rendering" || action === "set_audio_gain" || action === "apply_audio_envelope"
            || action === "set_layer_input_stage" || action === "set_text_style" || action === "set_layer_timing"
            || action === "add_shape_primitive" || action === "add_text_animator"
            || action === "add_mogrt_property" || action === "add_mogrt_media_layer" || action === "export_mogrt"
            || action === "set_essential_property" || action === "set_essential_media_source" || action === "apply_essential_bindings"
            || action === "apply_hand_track_rig"
            || action === "set_keyframe_interpolation" || action === "set_keyframe_temporal_ease" || action === "set_keyframe_temporal_flags" || action === "set_keyframe_spatial" || action === "remove_keyframe"
            || action === "duplicate_layer" || action === "remove_layer" || action === "precompose_layers"
            || action === "add_mask" || action === "edit_mask" || action === "remove_mask" || action === "add_scene_edit_markers" || action === "add_marker" || action === "remove_marker"
            || action === "add_render_queue_item" || action === "render_queue" || action === "save_project";
    }
    function assertProjectExpectation(request, action) {
        if (!mutationAction(action)) return;
        var expected = request.expected_project_file;
        if (typeof expected !== "string" || expected.length === 0 || expected.length > 4096) {
            fail("Mutating After Effects action requires exact expected_project_file.");
        }
        var expectedRevision=request.expected_project_revision;
        if(!finiteNumber(expectedRevision)||Math.floor(expectedRevision)!==expectedRevision||expectedRevision<1) {
            fail("Mutating After Effects action requires exact expected_project_revision.");
        }
        var project = requireProject();
        if (!project.file || !sameProjectPath(expected, project.file.fsName)) {
            fail("Active After Effects project file changed; mutation refused.");
        }
        if(project.revision!==expectedRevision) {
            fail("After Effects project revision changed; stale mutation refused.");
        }
    }
    function dispatch(request) {
        if (!request || request.schema_version !== 1) fail("Unsupported Shuvi After Effects request schema.");
        var action = boundedString(request.action, 80, "action");
        assertProjectExpectation(request, action);
        var args = request.args || {};
        if (action === "inspect_context") return inspectContext();
        if (action === "inspect_project_items") return inspectProjectItems();
        if (action === "inspect_comp") return inspectComp(args);
        if (action === "inspect_effects") return inspectEffects(args);
        if (action === "inspect_property") return inspectProperty(args);
        if (action === "inspect_keyframes") return inspectKeyframes(args);
        if (action === "inspect_layer_properties") return inspectLayerProperties(args);
        if (action === "inspect_av_layer_rendering") return inspectAVLayerRendering(args);
        if (action === "inspect_audio_levels") return inspectAudioLevels(args);
        if (action === "inspect_layer_input_stage") return inspectLayerInputStage(args);
        if (action === "inspect_mogrt") return inspectMogrt(args);
        if (action === "inspect_essential_properties") return inspectEssentialProperties(args);
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
        if (action === "set_comp_settings") return setCompSettings(args);
        if (action === "import_footage") return importFootage(args);
        if (action === "add_item_layer") return addItemLayer(args);
        if (action === "create_project_folder") return createProjectFolder(args);
        if (action === "set_project_item_state") return setProjectItemState(args);
        if (action === "remove_project_item") return removeProjectItem(args);
        if (action === "set_layer_state") return setLayerState(args);
        if (action === "set_layer_parent") return setLayerParent(args);
        if (action === "move_layer") return moveLayer(args);
        if (action === "set_track_matte") return setTrackMatte(args);
        if (action === "remove_track_matte") return removeTrackMatte(args);
        if (action === "set_time_remap") return setTimeRemap(args);
        if (action === "replace_source") return replaceSource(args);
        if (action === "relink_footage") return relinkFootage(args);
        if (action === "set_proxy") return setProxy(args);
        if (action === "remove_proxy") return removeProxy(args);
        if (action === "set_av_layer_flags") return setAVLayerFlags(args);
        if (action === "set_av_layer_rendering") return setAVLayerRendering(args);
        if (action === "set_audio_gain") return setAudioGain(args);
        if (action === "apply_audio_envelope") return applyAudioEnvelope(args);
        if (action === "set_layer_input_stage") return setLayerInputStage(args);
        if (action === "set_text_style") return setTextStyle(args);
        if (action === "set_layer_timing") return setLayerTiming(args);
        if (action === "add_shape_primitive") return addShapePrimitive(args);
        if (action === "add_text_animator") return addTextAnimator(args);
        if (action === "add_mogrt_property") return addMogrtProperty(args);
        if (action === "add_mogrt_media_layer") return addMogrtMediaLayer(args);
        if (action === "export_mogrt") return exportMogrt(args);
        if (action === "set_essential_property") return setEssentialProperty(args);
        if (action === "set_essential_media_source") return setEssentialMediaSource(args);
        if (action === "apply_essential_bindings") return applyEssentialBindings(args);
        if (action === "apply_hand_track_rig") return applyHandTrackRig(args);
        if (action === "set_keyframe_interpolation") return setKeyframeInterpolation(args);
        if (action === "set_keyframe_temporal_ease") return setKeyframeTemporalEase(args);
        if (action === "set_keyframe_temporal_flags") return setKeyframeTemporalFlags(args);
        if (action === "set_keyframe_spatial") return setKeyframeSpatial(args);
        if (action === "remove_keyframe") return removeKeyframe(args);
        if (action === "duplicate_layer") return duplicateLayer(args);
        if (action === "remove_layer") return removeLayer(args);
        if (action === "precompose_layers") return precomposeLayers(args);
        if (action === "add_mask") return addMask(args);
        if (action === "edit_mask") return editMask(args);
        if (action === "remove_mask") return removeMask(args);
        if (action === "inspect_scene_edits") return inspectSceneEdits(args);
        if (action === "add_scene_edit_markers") return addSceneEditMarkers(args);
        if (action === "inspect_markers") return inspectMarkers(args);
        if (action === "add_marker") return addMarker(args);
        if (action === "remove_marker") return removeMarker(args);
        if (action === "inspect_render_queue") return inspectRenderQueue();
        if (action === "add_render_queue_item") return addRenderQueueItem(args);
        if (action === "render_queue") return renderQueue(args);
        if (action === "save_project") return saveProject();
        fail("Unsupported Shuvi After Effects action.");
    }

    root.ShuviAE = {
        schemaVersion: 1,
        dispatch: dispatch
    };
})(this);
