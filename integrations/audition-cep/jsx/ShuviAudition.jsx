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
    var enabled = false;
    try { enabled = Boolean(app.isCommandEnabled(commandValue)); } catch (e0) { enabled = false; }
    if (!enabled) throw new Error("Audition reports that the inspected command is currently disabled.");

    app.invokeCommand(commandValue);

    return {
        accepted: true,
        property: args.property,
        value: commandValue,
        enabledBefore: true,
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
