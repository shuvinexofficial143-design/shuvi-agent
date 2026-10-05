/* Acceptance-only fixture lifecycle. Never shipped as a production action. */
(function(root){
    function fail(message){throw new Error(message);}
    function samePath(a,b){return new File(a).fsName.toLowerCase()===new File(b).fsName.toLowerCase();}
    function run(config){
        if(!config||config.schema_version!==1||!/^[a-f0-9]{32}$/.test(config.run_id)
            ||!/^[A-Za-z0-9_-]{1,80}$/.test(config.request_id))fail("Invalid acceptance fixture identity.");
        var dir=new Folder(config.fixture_dir),file=new File(config.project_file);
        if(!dir.exists||dir.name!=="shuvi-ae-acceptance-"+config.run_id
            ||!samePath(file.fsName,dir.fsName+"/acceptance.aep")||file.alias)
            fail("Fixture must be an exact fresh disposable acceptance directory.");
        var marker=new File(dir.fsName+"/owner.json");marker.encoding="UTF-8";
        if(!marker.exists||marker.alias||marker.length>16384||!marker.open("r"))fail("Fixture ownership marker unavailable.");
        var owner;try{owner=JSON.parse(marker.read());}finally{marker.close();}
        if(owner.schema_version!==1||owner.run_id!==config.run_id||!samePath(owner.project_file,file.fsName))
            fail("Fixture ownership marker does not match this run.");
        if(config.phase==="bootstrap"){
            if(file.exists)fail("Disposable fixture already exists; overwriting/retrying bootstrap is refused.");
            // newProject preserves Adobe's save/cancel prompt for even an edited empty project.
            // Never close a pre-existing project or rely on undocumented Project.dirty.
            if(app.project&&(app.project.file||app.project.numItems!==0))fail("A user project is open; fixture bootstrap refused.");
            var project=app.newProject();if(!project)fail("New disposable project was cancelled.");
            if(project!==app.project||project.file||project.numItems!==0)fail("Unexpected new project state.");
            project.save(file);
        }else if(config.phase==="reopen"){
            if(!app.project||!app.project.file||!samePath(app.project.file.fsName,file.fsName)
                ||app.project.revision!==config.expected_project_revision)
                fail("Disposable project/revision ownership changed before reopen.");
            if(!config.saved_file_verified||!config.checkpoint_verified||!file.exists
                ||file.length!==config.expected_size_bytes||!file.modified
                ||file.modified.getTime()!==config.expected_modified_ms)
                fail("Save/checkpoint evidence changed before reopen.");
            if(app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES)!==true)fail("Disposable project close was refused.");
            if(!app.open(file))fail("Disposable project reopen failed.");
        }else fail("Unsupported acceptance fixture lifecycle phase.");
        if(!app.project.file||!samePath(app.project.file.fsName,file.fsName)||!file.exists||file.length<=0)
            fail("Fixture save/open identity evidence failed.");
        return {schema_version:1,request_id:config.request_id,run_id:config.run_id,phase:config.phase,
            host_version:String(app.version),project_file:app.project.file.fsName,project_revision:app.project.revision,
            size_bytes:file.length,host_accepted:true,persistence_verified:false,visual_semantics_verified:false,
            runtime_verified:false,production_ready:false};
    }
    root.ShuviAEAcceptanceFixture={run:run};
})(this);
