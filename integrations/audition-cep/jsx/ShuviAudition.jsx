/* Shuvi Audition CEP host adapter.
   Keep this ES3-compatible: Audition CEP evaluates it with ExtendScript. */

function shuviAuditionBoundString(value, maxLength)
{
    var text = "";
    try { text = String(value); } catch (e) { text = ""; }
    if (text.length > maxLength) text = text.substring(0, maxLength);
    return text;
}

function shuviAuditionInspectContext()
{
    var out = {
        schemaVersion: 1,
        hostName: "Adobe Audition",
        hostVersion: null,
        hasDocument: false,
        documentType: null,
        documentName: null,
        sampleRate: null,
        durationSamples: null,
        durationSeconds: null,
        playheadSamples: null,
        playheadSeconds: null,
        documentSignature: "no_document",
        runtimeVerified: false
    };

    try { out.hostVersion = shuviAuditionBoundString(app.version, 80); } catch (e0) {}

    var doc = null;
    try { doc = app.activeDocument; } catch (e1) { doc = null; }
    if (!doc) return out;

    out.hasDocument = true;
    try { out.documentType = shuviAuditionBoundString(doc.reflect.name, 120); } catch (e2) {}
    try { out.documentName = shuviAuditionBoundString(doc.name, 512); } catch (e3) {}

    if (out.documentType == "WaveDocument")
    {
        try { out.sampleRate = Number(doc.sampleRate); } catch (e4) {}
        try { out.durationSamples = Number(doc.duration); } catch (e5) {}
        try { out.playheadSamples = Number(doc.playheadPosition); } catch (e6) {}

        if (out.sampleRate && out.sampleRate > 0)
        {
            if (out.durationSamples !== null) out.durationSeconds = out.durationSamples / out.sampleRate;
            if (out.playheadSamples !== null) out.playheadSeconds = out.playheadSamples / out.sampleRate;
        }
    }

    out.documentSignature = shuviAuditionBoundString(
        [out.documentType || "", out.documentName || "", out.sampleRate == null ? "" : out.sampleRate,
         out.durationSamples == null ? "" : out.durationSamples].join("|"),
        1200
    );

    return out;
}

function shuviAuditionListCommands()
{
    var commands = [];
    var truncated = false;
    var props = Application.reflect.properties;

    for (var p = 0; p < props.length; ++p)
    {
        var propertyName = props[p].name;
        if (propertyName.indexOf("COMMAND_") != 0) continue;

        if (commands.length >= 512)
        {
            truncated = true;
            break;
        }

        var commandValue = "";
        var help = "";
        try { commandValue = String(Application[propertyName]); } catch (e0) { commandValue = ""; }
        try { help = String(props[p].help || ""); } catch (e1) { help = ""; }

        if (!commandValue.length) continue;

        commands.push({
            property: shuviAuditionBoundString(propertyName, 240),
            value: shuviAuditionBoundString(commandValue, 240),
            help: shuviAuditionBoundString(help, 1000)
        });
    }

    return {
        count: commands.length,
        maxCommands: 512,
        truncated: truncated,
        commands: commands,
        source: "Application.reflect.properties COMMAND_*",
        runtimeVerified: false
    };
}

function shuviAuditionDictionaryMember(member)
{
    var out = {
        name: null,
        type: null,
        dataType: null,
        help: null,
        description: null
    };
    try { out.name = shuviAuditionBoundString(member.name, 160); } catch (e0) {}
    try { out.type = shuviAuditionBoundString(member.type, 80); } catch (e1) {}
    try { out.dataType = shuviAuditionBoundString(member.dataType, 160); } catch (e2) {}
    try { out.help = shuviAuditionBoundString(member.help, 500); } catch (e3) {}
    try { out.description = shuviAuditionBoundString(member.description, 1000); } catch (e4) {}
    return out;
}

function shuviAuditionDictionaryMembers(items, maxItems)
{
    var output = [];
    var sourceLength = items && typeof items.length == "number" ? items.length : 0;
    var limit = Math.min(sourceLength, maxItems);
    for (var i = 0; i < limit; ++i)
    {
        output.push(shuviAuditionDictionaryMember(items[i]));
    }
    return {
        count: output.length,
        sourceCount: sourceLength,
        truncated: sourceLength > limit,
        items: output
    };
}

function shuviAuditionScriptDictionary(args)
{
    var query = "";
    if (args && typeof args.query == "string")
    {
        query = args.query.toLowerCase();
        if (query.length > 120) throw new Error("Script Dictionary query exceeds 120 characters.");
    }

    var maxClasses = Number(args && args.maxClasses != null ? args.maxClasses : 64);
    if (isNaN(maxClasses) || Math.floor(maxClasses) != maxClasses || maxClasses < 1 || maxClasses > 128)
        throw new Error("Script Dictionary maxClasses must be an integer from 1 to 128.");

    var groups = $.dictionary.getGroups();
    var groupNames = [];
    var rawGroups = groups && typeof groups.length == "number" ? groups : [];
    for (var g = 0; g < rawGroups.length && groupNames.length < 64; ++g)
    {
        var groupValue = rawGroups[g];
        var groupName = "";
        if (groupValue && typeof groupValue.length == "number" && typeof groupValue != "string")
            groupName = groupValue.length ? String(groupValue[0]) : "";
        else
            groupName = String(groupValue || "");
        if (groupName.length) groupNames.push(shuviAuditionBoundString(groupName, 160));
    }
    if (!groupNames.length) groupNames.push("");

    var seen = {};
    var classes = [];
    var scannedClasses = 0;
    var truncated = false;

    for (var gi = 0; gi < groupNames.length; ++gi)
    {
        var names = $.dictionary.getClasses(groupNames[gi]);
        if (!names || typeof names.length != "number") continue;

        for (var ci = 0; ci < names.length; ++ci)
        {
            scannedClasses += 1;
            var rawName = String(names[ci] || "");
            var className = rawName.split("\t")[0];
            if (!className.length || seen[className]) continue;
            seen[className] = true;

            if (query.length && className.toLowerCase().indexOf(query) < 0) continue;
            if (classes.length >= maxClasses)
            {
                truncated = true;
                break;
            }

            var ref = $.dictionary.getClass(className);
            if (!ref) continue;

            classes.push({
                name: shuviAuditionBoundString(className, 160),
                group: shuviAuditionBoundString(groupNames[gi], 160),
                help: shuviAuditionBoundString(ref.help || "", 500),
                description: shuviAuditionBoundString(ref.description || "", 1000),
                staticProperties: shuviAuditionDictionaryMembers(ref.staticProperties, 64),
                staticMethods: shuviAuditionDictionaryMembers(ref.staticMethods, 64),
                properties: shuviAuditionDictionaryMembers(ref.properties, 64),
                methods: shuviAuditionDictionaryMembers(ref.methods, 64)
            });
        }
        if (truncated) break;
    }

    return {
        schemaVersion: 1,
        query: query,
        groupCount: groupNames.length,
        groups: groupNames,
        scannedClasses: scannedClasses,
        returnedClasses: classes.length,
        maxClasses: maxClasses,
        maxMembersPerCategory: 64,
        truncated: truncated,
        classes: classes,
        source: "$.dictionary",
        readOnly: true,
        runtimeVerified: false
    };
}

function shuviAuditionSearchCommands(args)
{
    var query = args && typeof args.query == "string" ? args.query.toLowerCase() : "";
    if (!query.length || query.length > 120) throw new Error("Command search query must be 1 to 120 characters.");

    var inventory = shuviAuditionListCommands();
    var matches = [];
    for (var i = 0; i < inventory.commands.length && matches.length < 100; ++i)
    {
        var row = inventory.commands[i];
        var haystack = [row.property || "", row.value || "", row.help || ""].join(" ").toLowerCase();
        if (haystack.indexOf(query) >= 0) matches.push(row);
    }

    return {
        query: query,
        count: matches.length,
        maxMatches: 100,
        truncated: matches.length >= 100,
        commands: matches,
        sourceCount: inventory.count,
        runtimeVerified: false
    };
}

function shuviAuditionResolveCommand(propertyName, commandValue)
{
    if (typeof propertyName != "string" || typeof commandValue != "string")
        throw new Error("Command property and value must be strings.");
    if (!propertyName.length || propertyName.length > 240 || propertyName.indexOf("COMMAND_") != 0)
        throw new Error("Command property is invalid.");
    if (!commandValue.length || commandValue.length > 240)
        throw new Error("Command value is invalid.");

    var liveValue = null;
    try { liveValue = String(Application[propertyName]); } catch (e) { liveValue = null; }
    if (liveValue === null || liveValue != commandValue)
        throw new Error("Audition command identity changed; inspect the command inventory again.");

    return liveValue;
}

function shuviAuditionCommandEnabled(args)
{
    var commandValue = shuviAuditionResolveCommand(args.property, args.value);
    var enabled = false;
    try { enabled = Boolean(app.isCommandEnabled(commandValue)); } catch (e) { enabled = false; }

    return {
        property: args.property,
        value: commandValue,
        enabled: enabled,
        runtimeVerified: false
    };
}

function shuviAuditionInvokeCommand(args)
{
    var commandValue = shuviAuditionResolveCommand(args.property, args.value);
    var expectedSignature = args && typeof args.expectedDocumentSignature == "string" ? args.expectedDocumentSignature : "";
    if (!expectedSignature.length || expectedSignature.length > 1200)
        throw new Error("Exact expected Audition document signature is required.");

    var context = shuviAuditionInspectContext();
    if (context.documentSignature != expectedSignature)
        throw new Error("Audition document changed; inspect context again before invoking the command.");

    var enabled = false;
    try { enabled = Boolean(app.isCommandEnabled(commandValue)); } catch (e0) { enabled = false; }
    if (!enabled) throw new Error("Audition reports that the inspected command is currently disabled.");

    app.invokeCommand(commandValue);

    return {
        accepted: true,
        property: args.property,
        value: commandValue,
        enabledBefore: true,
        expectedDocumentSignature: expectedSignature,
        observedDocumentSignature: context.documentSignature,
        verificationStatus: "accepted_unverified_command_side_effect",
        retrySafe: false,
        runtimeVerified: false
    };
}

function shuviAuditionSetPlayheadPercent(args)
{
    var percent = Number(args.percent);
    if (isNaN(percent) || percent < 0 || percent > 1)
        throw new Error("Playhead percent must be between 0 and 1.");

    var expectedSignature = args && typeof args.expectedDocumentSignature == "string" ? args.expectedDocumentSignature : "";
    if (!expectedSignature.length || expectedSignature.length > 1200)
        throw new Error("Exact expected Audition document signature is required.");
    var beforeContext = shuviAuditionInspectContext();
    if (beforeContext.documentSignature != expectedSignature)
        throw new Error("Audition document changed; inspect context again before moving the playhead.");

    var doc = null;
    try { doc = app.activeDocument; } catch (e0) { doc = null; }
    if (!doc || doc.reflect.name != "WaveDocument")
        throw new Error("Waveform playhead control requires an active WaveDocument.");

    var duration = Number(doc.duration);
    if (isNaN(duration) || duration < 0)
        throw new Error("WaveDocument duration is unavailable.");

    var expected = duration * percent;
    doc.playheadPosition = expected;

    var observed = Number(doc.playheadPosition);
    var verified = !isNaN(observed) && Math.abs(observed - expected) <= 1;

    return {
        requestedPercent: percent,
        expectedDocumentSignature: expectedSignature,
        observedDocumentSignature: beforeContext.documentSignature,
        expectedSamples: expected,
        observedSamples: isNaN(observed) ? null : observed,
        verificationStatus: verified ? "verified_playhead_readback" : "accepted_unverified",
        uncertain: !verified,
        retrySafe: true,
        runtimeVerified: false
    };
}

function shuviAuditionDispatch(action, encodedArgs)
{
    try
    {
        var args = {};
        if (encodedArgs && encodedArgs.length)
        {
            var decoded = decodeURIComponent(encodedArgs);
            args = eval("(" + decoded + ")");
        }

        var data = null;
        if (action == "inspect_context") data = shuviAuditionInspectContext();
        else if (action == "list_commands") data = shuviAuditionListCommands();
        else if (action == "search_commands") data = shuviAuditionSearchCommands(args);
        else if (action == "script_dictionary") data = shuviAuditionScriptDictionary(args);
        else if (action == "command_enabled") data = shuviAuditionCommandEnabled(args);
        else if (action == "set_playhead_percent") data = shuviAuditionSetPlayheadPercent(args);
        else if (action == "invoke_command") data = shuviAuditionInvokeCommand(args);
        else throw new Error("Unsupported Shuvi Audition action: " + action);

        return ({ok:true,data:data}).toSource();
    }
    catch (error)
    {
        return ({ok:false,error:shuviAuditionBoundString(error,2000)}).toSource();
    }
}
