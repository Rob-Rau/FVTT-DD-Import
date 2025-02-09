Hooks.on("renderSidebarTab", async (app, html) => {
  if (app.options.id == "scenes") {
    let new_scene_button = $("<button class='import-dd'><i class='fas fa-file-import'></i> Universal Battlemap Import</button>")
    let to_scene_button = $("<button class='import-dd'><i class='fas fa-file-import'></i> Universal Battlemap Import to Scene</button>")

    new_scene_button.click(function () {
      new DDImporter(false).render(true);
    });

    to_scene_button.click(function () {
      new DDImporter(true).render(true);
    });


    html.find(".directory-footer").append(new_scene_button);
    html.find(".directory-footer").append(to_scene_button);
  }
})

Hooks.on("init", () => {
  game.settings.register("dd-import", "importSettings", {
    name: "Dungeondraft Default Path",
    scope: "world",
    config: false,
    default: {
      source: "data",
      bucket: "",
      region: "",
      path: "worlds/" + game.world.data.name,
      offset: 0.0,
      fidelity: 3,
      multiImageMode: "g",
      webpConversion: true,
      wallsAroundFiles: true,
    }
  })

  game.settings.register("dd-import", "openableWindows", {
    name: "Openable Windows",
    hint: "Should windows be openable? Note that you can make portals import as windows by unchecking 'block light' in Dungeondraft",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  })
})




class DDImporter extends Application
{

  constructor(into_scene) {
    super()
    this.into_scene = into_scene;
    this.have_levels = game.modules.get("levels") !== undefined;
    this.have_wall_height = game.modules.get("wall-height") !== undefined;
    this.have_better_roofs = game.modules.get("betterroofs") !== undefined;

    console.log("Constructing DDImporter...");
    console.log("   Is Levels installed? ", this.have_levels);
    console.log("   Is Wall Height installed? ", this.have_wall_height);
    console.log("   Is Better Roofs installed? ", this.have_better_roofs);

  }

  static get defaultOptions()
  {
      const options = super.defaultOptions;
      options.id = "dd-importer";
      options.template = "modules/dd-import/importer.html"
      options.classes.push("dd-importer");
      options.resizable = false;
      options.height = "auto";
      options.width = 400;
      options.minimizable = true;
      options.title = "Universal Battlemap Importer"
      return options;
  }


  getData(){
    let data = super.getData();
    let settings = game.settings.get("dd-import", "importSettings")

    data.dataSources = {
      data: "User Data",
      s3 : "S3"
    }
    data.defaultSource = settings.source || "data";

    data.s3Bucket = settings.bucket || "";
    data.s3Region = settings.region || "";
    data.path = settings.path || "";
    data.offset = settings.offset || 0;
    data.padding = settings.padding || 0.25

    data.multiImageModes = {
      "g": "Grid",
      "y": "Vertical",
      "x": "Horizontal",
    }
    data.multiImageMode = settings.multiImageMode || "g";
    data.webpConversion = settings.webpConversion;
    data.wallsAroundFiles = settings.wallsAroundFiles;

    return data
  }

  activateListeners(html)
  {
    super.activateListeners(html)

    DDImporter.checkPath(html)
    DDImporter.checkFidelity(html)
    DDImporter.checkSource(html)
    this.setRangeValue(html)

    if(this.into_scene) {
      let sceneSelector = $(
        `<select name="scene-selector">`
          +Array.from(game.scenes.entries()).map(s => `<option value="`+s[0]+`">`+s[1].name+`</option>`).join("\n")+
        `</select>
        <div class="form-group import" title="Is tile overhead">
          <label class="import-options">Is Overhead</label>
          <input type="checkbox" name="overhead">
        </div>
        `
      );
      
      html.find("[name='sceneName']").replaceWith(sceneSelector);
    }

    if(this.have_levels || this.have_wall_height) {
      let levelsRangeInput = $(
          `<div>
            <hr/>
            <h3>Levels Range</h3>
            <div class="form-group import" id="dd-levels-range">
              <label class="import-options">Level Bottom</label><input type='text' name="levelBottom" />
              <label class="import-options">Level Top</label><input type='text' name="levelTop" />
            </div>
          </div>`
        );

        html.find("#dd-upload-files").after(levelsRangeInput);
    }

    html.find(".path-input").keyup(ev => DDImporter.checkPath(html))
    html.find(".fidelity-input").change(ev => DDImporter.checkFidelity(html))
    html.find(".source-selector").change(ev => DDImporter.checkSource(html))
    
    html.find(".padding-input").change(ev => this.setRangeValue(html))

    html.find(".add-file").click(async ev => {
      var newfile = document.createElement("input");
      let counter = html.find('[name="filecount"]')[0]
      newfile.setAttribute("class", "file-input")
      newfile.setAttribute("type", "file")
      newfile.setAttribute("accept", ".dd2vtt,.df2vtt,.uvtt")
      newfile.setAttribute("name", "file"+counter.value)
      counter.value = parseInt(counter.value) + 1
      let files = html.find("#dd-upload-files")[0]
      files.insertBefore(newfile,counter)
      html.find(".multi-mode-section")[0].style.display = ""
    })



    html.find(".import-map").click(async ev => {
      try
      {
        let sceneName = html.find('[name="sceneName"]').val()
        let fidelity = parseInt(html.find('[name="fidelity"]').val())
        let offset = parseFloat(html.find('[name="offset"]').val().replace(',', '.'))
        let padding = parseFloat(html.find('[name="padding"]').val())
        let source = html.find('[name="source"]').val()
        let bucket = html.find('[name="bucket"]').val()
        let region = html.find('[name="region"]').val()
        let path = html.find('[name="path"]').val()
        let filecount = html.find('[name="filecount"]').val()
        let mode =  html.find('[name="multi-mode"]').val()
        let toWebp =  html.find('[name="convert-to-webp"]')[0].checked
        
        let objectWalls =  html.find('[name="object-walls"]')[0].checked
        let wallsAroundFiles =  html.find('[name="walls-around-files"]')[0].checked
        let imageFileName = html.find('[name="imageFileName"]').val()

        var levelRange = [];

        var isOverhead = false
        if(this.into_scene) {
          isOverhead =  html.find('[name="overhead"]')[0].checked
        }

        if(this.have_levels || this.have_wall_height) {
          let levelBottom = html.find('[name="levelBottom"]').val()
          let levelTop = html.find('[name="levelTop"]').val()

          levelRange = [levelBottom, levelTop];
        }

        var firstFileName

        if ((!bucket || !region) && source == "s3")
          return ui.notifications.error("Bucket and Region required for S3 upload")

        this.close();
        let files = []
        var fileName = 'combined'
        for (var i=0; i < filecount; i++){
          let fe = html.find("[name=file"+i+"]")
          if (fe[0].files[0] === undefined){
            console.log("SKIPPING")
            continue
          }
          try {
            files.push(JSON.parse(await fe[0].files[0].text()));
            fileName = fileName + '-' + fe[0].files[0].name.split(".")[0];
            // save the first filename
            if(files.length == 1){
              firstFileName = fe[0].files[0].name.split(".")[0]
            }
          }catch(e){
            if (filecount > 1){
              ui.notifications.warning("Skipping due to error while importing: " + fe[0].files[0].name + " " + e)
            }else{
              throw(e)
            }
          }
        }
        // keep the original filename if it is only one file at all
        if (files.length == 0){
          ui.notifications.error("Skipped all files while importing.")
          throw new Error("Skipped all files");
        }
        if (files.length == 1){
          fileName = firstFileName;
        }else{
          ui.notifications.notify("Combining images may take quite some time, be patient")
        }
        if (imageFileName){
          fileName = imageFileName
          firstFileName = imageFileName
        }
        // lets use the first filename for the scene
        if (sceneName == ''){
          sceneName = firstFileName
        }

        // do the placement math
        let size = {}
        size.x = files[0].resolution.map_size.x
        size.y = files[0].resolution.map_size.y
        let grid_size = { 'x': size.x, 'y': size.y }
        size.x = size.x * files[0].resolution.pixels_per_grid
        size.y = size.y * files[0].resolution.pixels_per_grid

        let count = files.length
        var width, height, gridw, gridh
        // respect the stitching mode
        if (mode == 'y'){
          // vertical stitching
          gridw = grid_size.x
          gridh = count * grid_size.y
          for (var f=0; f < files.length; f++){
            files[f].pos_in_image = {"x": 0, "y": f * size.y}
            files[f].pos_in_grid = {"x": 0, "y": f * grid_size.y}
          }
        }else if( mode == 'x'){
          // horizontal stitching
          for (var f=0; f < files.length; f++){
            files[f].pos_in_image = {"y": 0, "x": f * size.x}
            files[f].pos_in_grid = {"y": 0, "x": f * grid_size.x}
          }
          gridw = count * grid_size.x
          gridh = grid_size.y
        }else if( mode == 'g'){
          // grid is the most complicated one
          // we count the rows, as we fill them up first, e.g. 5 images will end up in 2 rows, the first with 3 the second with two images.
          var vcount = 0
          var hcount = count
          var index = 0
          let hwidth = Math.ceil(Math.sqrt(count))
          // continue as there are images left
          while (hcount > 0){
            var next_v_index = index + hwidth
            // fill up each row, until all images are placed
            while (index < Math.min(next_v_index, files.length)){
              files[index].pos_in_image = { "y": vcount * size.y, "x": (index - vcount * hwidth) * size.x }
              files[index].pos_in_grid = { "y": vcount * grid_size.y, "x": (index - vcount * hwidth) * grid_size.x }
              index += 1
            }
            hcount -= hwidth
            vcount += 1
          }
          gridw = hwidth * grid_size.x
          gridh = vcount * grid_size.y
        }
        width = gridw * files[0].resolution.pixels_per_grid
        height = gridh * files[0].resolution.pixels_per_grid
        //placement math done.
        //Now use the image direct, in case of only one image and no conversion required
        var image_type = '?'
        if (files.length == 1){
          image_type = DDImporter.getImageType(atob(files[0].image.substr(0,8)));
        }
        if ((image_type == 'webp' || !toWebp) && files.length == 1){
          let bfr = DDImporter.DecodeImage(files[0])
          ui.notifications.notify("Uploading image ....")
          DDImporter.uploadFile(bfr, fileName, path, source, image_type, bucket)
        }else{
          // Use a canvas to place the image in case we need to convert something
          let thecanvas = document.createElement('canvas');
          thecanvas.width = width;
          thecanvas.height = height;
          let mycanvas = thecanvas.getContext("2d");
          ui.notifications.notify("Processing Images")
          for (var fidx=0; fidx < files.length; fidx++){
            ui.notifications.notify("Combining " + (fidx + 1) + " out of " + files.length)
            let f = files[fidx];
            image_type = DDImporter.getImageType(atob(f.image.substr(0,8)));
            await DDImporter.image2Canvas(mycanvas, f, image_type)
          }
          ui.notifications.notify("Uploading image ....")
          if (toWebp){
            image_type = 'webp';
          }

          var p = new Promise(function(resolve) {
            thecanvas.toBlob(function (blob) {
              blob.arrayBuffer().then(bfr => {
                DDImporter.uploadFile(bfr, fileName, path, source, image_type, bucket)
                  .then(function(){
                    resolve()
                })
              })
            }, "image/"+image_type);})
        }

        // aggregate the walls and place them right
        let aggregated = {
          "format": 0.2,
          "resolution": {
            "map_origin": {"x": 0, "y": 0},
            "map_size": {"x": gridw, "y": gridh},
            "pixels_per_grid": files[0]["resolution"]["pixels_per_grid"],
          },
          "line_of_sight": [],
          "portals": [],
          "environment": files[0]["environment"],
          "lights": [],
        }

        // adapt the walls
        for (var fidx=0; fidx < files.length; fidx++){
          let f = files[fidx];
          if (objectWalls)
            f.line_of_sight = f.line_of_sight.concat(f.objects_line_of_sight || [])
          f.line_of_sight.forEach(function(los){
            los.forEach(function(z){
              z.x += f.pos_in_grid.x
              z.y += f.pos_in_grid.y
            })
          })
          f.portals.forEach(function(port){
            port.position.x += f.pos_in_grid.x
            port.position.y += f.pos_in_grid.y
            port.bounds.forEach(function(z){
              z.x += f.pos_in_grid.x
              z.y += f.pos_in_grid.y
            })
          })
          f.lights.forEach(function(port){
            port.position.x += f.pos_in_grid.x
            port.position.y += f.pos_in_grid.y
          })

          aggregated.line_of_sight = aggregated.line_of_sight.concat(f.line_of_sight)
          //Add wall around the image
          if (wallsAroundFiles && files.length > 1){
          aggregated.line_of_sight.push(
            [
              {'x':f.pos_in_grid.x, 'y': f.pos_in_grid.y},
              {'x':f.pos_in_grid.x + f.resolution.map_size.x, 'y': f.pos_in_grid.y},
              {'x':f.pos_in_grid.x + f.resolution.map_size.x, 'y': f.pos_in_grid.y + f.resolution.map_size.y},
              {'x':f.pos_in_grid.x , 'y': f.pos_in_grid.y + f.resolution.map_size.y},
              {'x':f.pos_in_grid.x, 'y': f.pos_in_grid.y}
            ])
          }
          aggregated.lights = aggregated.lights.concat(f.lights)
          aggregated.portals = aggregated.portals.concat(f.portals)
        }
        ui.notifications.notify("upload still in progress, please wait")
        await p

        var scene
        if(this.into_scene) {
          var sceneId = html.find('[name="scene-selector"]').val()
          scene = game.scenes.get(sceneId)
          console.log("Adding to existing scene: ", scene.name)

        } else {
          ui.notifications.notify("creating scene")
          console.log("Creating scene: ", sceneName)
          scene = new Scene({
            name: sceneName,
            grid: aggregated.resolution.pixels_per_grid,
            width: aggregated.resolution.pixels_per_grid * aggregated.resolution.map_size.x,
            height: aggregated.resolution.pixels_per_grid * aggregated.resolution.map_size.y,
            padding: padding,
            shiftX : 0,
            shiftY : 0
          })

          console.log("Scene created: ", scene)
        }
        
        DDImporter.DDImport(aggregated, scene, fileName, path, fidelity, offset, padding, image_type, bucket, region, source, levelRange, !this.into_scene, isOverhead, this.have_levels, this.have_wall_height)

        game.settings.set("dd-import", "importSettings", {
          source: source,
          bucket: bucket,
          region: region,
          path: path,
          offset: offset,
          padding: padding,
          fidelity: fidelity,
          multiImageMode: mode,
          webpConversion: toWebp,
          wallsAroundFiles: wallsAroundFiles,
        });
      }
      catch (e)
      {
        console.error(e)
        ui.notifications.error("Error Importing: " + e)
      }

    })
  }

  setRangeValue(html)
  {
    let val = html.find(".padding-input").val()
    html.find(".range-value")[0].textContent = val
  }

  static checkPath(html)
  {
    let pathValue = $("[name='path']")[0].value
    if (pathValue[1] == ":")
    {
      html.find(".warning.path")[0].style.display = ""
    }
    else
      html.find(".warning.path")[0].style.display = "none"
  }

  static checkFidelity(html)
  {
    let fidelityValue= $("[name='fidelity']")[0].value
    if (Number(fidelityValue) > 1)
    {
      html.find(".warning.fidelity")[0].style.display = ""
    }
    else
      html.find(".warning.fidelity")[0].style.display = "none"

  }

  static checkSource(html)
  {
    let sourceValue= $("[name='source']")[0].value
    if (sourceValue == "s3")
    {
      html.find(".s3-section")[0].style.display=""
    }
    else
    {
      html.find(".s3-section")[0].style.display="none"
    }

  }


  static DecodeImage(file){
    var byteString = atob(file.image);
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);

    for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return ab;
  }

  static Uint8ToBase64(u8Arr){
    var CHUNK_SIZE = 0x8000;
    var index = 0;
    var length = u8Arr.length;
    var result = '';
    var slice;
    // we need to do slices for large amount of data
    while (index < length) {
      slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
      result += String.fromCharCode.apply(null, slice);
      index += CHUNK_SIZE;
    }
    return btoa(result);
  }

  static getImageType(bytes){
    let magic = bytes.substr(0,4);
    console.log(magic);
    console.log(magic.charCodeAt(0));
    if (magic == "\u0089PNG"){
      return 'png'
    }else if (magic == "RIFF"){
      return 'webp';
    }else if (magic == "\u00ff\u00d8\u00ff\u00e0"){
      return 'jpeg';
    }
    return 'png';
  }

  static image2Canvas(canvas, file, extension){
    return new Promise( function(resolve){
      var image = new Image();
      image.decoding = 'sync';
      image.addEventListener('load', function() {
          image.decode().then(() => {
            canvas.drawImage(image, file.pos_in_image.x, file.pos_in_image.y);
            resolve()
          }).catch(e => {
            console.log("decode failed because of DOMException, lets try directly");
            console.log(e);
            canvas.drawImage(image, file.pos_in_image.x, file.pos_in_image.y);
            resolve()
          });
      });
      image.src = "data:image/"+extension+";base64,"+file.image
    });
  }

  static async uploadFile(file, name, path, source, extension, bucket) {
    let uploadFile = new File([file], name + "." + extension, { type: 'image/' + extension });
    await FilePicker.upload(source, path, uploadFile, { bucket: bucket })
  }

  static async DDImport(file, scene, fileName, path, fidelity, offset, padding, extension, bucket, region, source, levelRange, createScene, isOverhead, haveLevels, haveWallHeight) {
    if (path && path[path.length-1] != "/")
      path = path + "/"
    let imagePath = path + fileName + "." + extension;
    if (source === "s3") {
      if (imagePath[0] != "/")
        imagePath = "/" + imagePath
      imagePath = "https://" + bucket + ".s3." + region + ".amazonaws.com" + imagePath;
    }

    console.log("Updating scene with walls, lights, and tiles")

    var updateObject
    if(createScene) {
      updateObject = scene.data
    } else {
      updateObject = scene
    }

    updateObject.update(
      {
        walls : this.GetWalls(file, scene, 6 - fidelity, offset, levelRange, haveWallHeight).concat(this.GetDoors(file, scene, offset, levelRange, haveWallHeight)).map(w => w.toObject()), 
        lights : this.GetLights(file, scene, levelRange, haveLevels).map(l => l.toObject()),
        tiles: [new TileDocument({
          img: imagePath,
          x: scene.dimensions.paddingX,
          y: scene.dimensions.paddingY,
          width: file.resolution.pixels_per_grid * file.resolution.map_size.x,
          height: file.resolution.pixels_per_grid * file.resolution.map_size.y,
          overhead: isOverhead,
          flags: haveLevels ? {
            levels: {
              isBasement: false,
              noFogHide: false,
              rangeBottom: levelRange[0],
              rangeTop: levelRange[1],
              showIfAbove: true
            }
          } : {}
        }, scene)].map(l => l.toObject())
      })

    if(createScene) {
      console.log("actually creating scene")
      let createdScene = await Scene.create(scene.data);
      createdScene.createThumbnail().then(thumb => {
        createdScene.update({"thumb" :  thumb.thumb});
      })
    }
  }

  static GetWalls(file, scene, skipNum, offset, levelRange, haveWallHeight) {
    let walls = [];
    let ddWalls = file.line_of_sight

    for (let wsIndex = 0; wsIndex < ddWalls.length; wsIndex++) {
      let wallSet = ddWalls[wsIndex]
      // Find walls that directly end on this walls endpoints. So we can close walls, after applying offets
      let connectTo = []
      let connectedTo = []
      for (let i = 0; i < ddWalls.length; i++) {
        if (i == wsIndex) continue
        if (wallSet[wallSet.length - 1].x == ddWalls[i][0].x && wallSet[wallSet.length - 1].y == ddWalls[i][0].y) {
          connectTo.push(ddWalls[i][0])
        }
        if (wallSet[0].x == ddWalls[i][ddWalls[i].length - 1].x && wallSet[0].y == ddWalls[i][ddWalls[i].length - 1].y) {
          connectedTo.push(wallSet[0])
        }
      }
      if (offset != 0) {
        wallSet = this.makeOffsetWalls(wallSet, offset)
      }
      wallSet = this.preprocessWalls(wallSet, skipNum)
      // Connect to walls that end *before* the current wall
      for (let i = 0; i < connectedTo.length; i++) {
        walls.push(this.makeWall(file, scene, connectedTo[i], wallSet[0], levelRange, haveWallHeight))
      }
      for (let i = 0; i < wallSet.length - 1; i++) {
        walls.push(this.makeWall(file, scene, wallSet[i], wallSet[i + 1], levelRange, haveWallHeight))
      }
      // Connect to walls that end *after* the current wall
      for (let i = 0; i < connectTo.length; i++) {
        walls.push(this.makeWall(file, scene, wallSet[wallSet.length - 1], connectTo[i], levelRange, haveWallHeight))
      }
    }

    return walls
  }

  static makeWall(file, scene, pointA, pointB, levelRange, haveWallHeight) {
    let sceneDimensions = Canvas.getDimensions(scene.data)
    let offsetX = sceneDimensions.paddingX;
    let offsetY = sceneDimensions.paddingY;
    return new WallDocument({
      c: [
        (pointA.x * file.resolution.pixels_per_grid) + offsetX,
        (pointA.y * file.resolution.pixels_per_grid) + offsetY,
        (pointB.x * file.resolution.pixels_per_grid) + offsetX,
        (pointB.y * file.resolution.pixels_per_grid) + offsetY
      ],
      flags: haveWallHeight ? {
          wallHeight: {
            wallHeightBottom: levelRange[0],
            wallHeightTop: levelRange[1]
          }
        } : {}
    })
  }

  static preprocessWalls(wallSet, numToSkip) {
    let toRemove = [];
    let skipCounter = 0;
    for (let i = 0; i < wallSet.length - 2; i++) {
      if (i != 0 && i != wallSet.length - 2 && this.distance(wallSet[i], wallSet[i + 1]) < 0.3) {
        if (skipCounter == numToSkip) {
          skipCounter = 0;
        }
        else {
          skipCounter++;
          toRemove.push(i);
        }
      }
      else
        skipCounter = 0;
    }
    if (toRemove.length) {
      for (let i = toRemove.length - 1; i > 0; i--) {
        wallSet.splice(toRemove[i], 1)
      }
    }
    return wallSet
  }

  static makeOffsetWalls(wallSet, offset, shortWallThreshold = 0.3, shortWallAmountThreshold = 70) {
    let wallinfo = [];
    let shortWalls = this.GetShortWallCount(wallSet, shortWallThreshold);
    // Assume short wallsets or containing long walls are not caves.
    let shortWallAmount = Math.round((shortWalls / wallSet.length) * 100);
    if (wallSet.length < 10 || shortWallAmount < shortWallAmountThreshold) {
      return wallSet
    }
    // connect the ends if they match
    if (wallSet[0].x == wallSet[wallSet.length - 1].x && wallSet[0].y == wallSet[wallSet.length - 1].y) {
      wallSet.push(wallSet[1]);
      wallSet.push(wallSet[2]);
    }
    for (let i = 0; i < wallSet.length - 1; i++) {
      let slope;
      let myoffset;
      let woffset;
      let m;
      if ((wallSet[i + 1].x - wallSet[i].x) == 0) {
        slope = undefined;
        myoffset = offset;
        if (wallSet[i + 1].y < wallSet[i].y) {
          myoffset = -myoffset;
        }
        woffset = { x: myoffset, y: 0 }
        m = 0;
      } else {
        slope = ((wallSet[i + 1].y - wallSet[i].y) / (wallSet[i + 1].x - wallSet[i].x))
        let dir = (wallSet[i + 1].x - wallSet[i].x) >= 0;
        woffset = this.GetOffset(slope, offset, dir);
        m = wallSet[i].x + woffset.x - wallSet[i].y + woffset.y
      }
      let x = wallSet[i].x + woffset.x
      let y = wallSet[i].y + woffset.y
      wallinfo.push({
        x: x,
        y: y,
        slope: slope,
        m: m
      })
    }
    let newWallSet = []
    for (let i = 0; i < wallSet.length - 2; i++) {
      newWallSet.push(this.interception(wallinfo[i], wallinfo[i + 1]));
    }
    return newWallSet
  }

  static GetShortWallCount(wallSet, shortWallThreshold) {
    let shortCount = 0;
    for (let i = 0; i < wallSet.length - 1; i++) {
      if (this.distance(wallSet[i], wallSet[i + 1]) < shortWallThreshold) {
        shortCount++;
      }
    }
    return shortCount
  }

  static GetOffset(slope, offset, dir) {
    let yoffset = Math.sqrt((offset * offset) / (1 + slope * slope));
    let xoffset = slope * yoffset;
    if ((slope <= 0 && dir) || (slope > 0 && dir)) {
      return { x: xoffset, y: -yoffset }
    }
    return { x: -xoffset, y: yoffset }
  }

  static interception(wallinfo1, wallinfo2) {
    /*
     * x = (m2-m1)/(k1-k2)
     * y = k1*x + m1
     */
    if(wallinfo1.slope == undefined && wallinfo2.slope == undefined){
      return { x: wallinfo1.x, y: (wallinfo1.y + wallinfo2.y)/2 }
    }
    else if (wallinfo1.slope == undefined) {
      let m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x
      return { x: wallinfo1.x, y: wallinfo2.slope * wallinfo1.x + m2 }
    }
    else if (wallinfo2.slope == undefined) {
      let m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x
      return { x: wallinfo2.x, y: wallinfo1.slope * wallinfo2.x + m1 }
    }
    /* special case if we skipped a short wall, which leads to two parallel walls, 
     * or we have a straight wall with multiple points. */
    else if (wallinfo1.slope == wallinfo2.slope){
      if (wallinfo1.slope == 0){
        return { x: wallinfo1.x + (wallinfo2.x-wallinfo1.x)/2, y: wallinfo1.y }
      }else{
        return { x: wallinfo1.x, y: wallinfo1.y + (wallinfo2.y-wallinfo1.y)/2 }
      }

    }
    let m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x
    let m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x
    let x = (m2 - m1) / (wallinfo1.slope - wallinfo2.slope)
    return { x: x, y: wallinfo1.slope * x + m1 }
  }

  static distance(p1, p2) {
    return Math.sqrt(Math.pow((p1.x - p2.x), 2) + Math.pow((p1.y - p2.y), 2))
  }

  static GetDoors(file, scene, offset, levelRange, haveWallHeight) {
    let doors = [];
    let ddDoors = file.portals;
    let sceneDimensions = Canvas.getDimensions(scene.data)
    let offsetX = sceneDimensions.paddingX;
    let offsetY = sceneDimensions.paddingY;

    if (offset != 0) {
      ddDoors = this.makeOffsetWalls(ddDoors, offset)
    }
    for (let door of ddDoors) {
      doors.push(new WallDocument({
        c : [
          (door.bounds[0].x   * file.resolution.pixels_per_grid) + offsetX,
          (door.bounds[0].y   * file.resolution.pixels_per_grid) + offsetY,
          (door.bounds[1].x * file.resolution.pixels_per_grid) + offsetX,
          (door.bounds[1].y * file.resolution.pixels_per_grid) + offsetY
        ],
        flags: haveWallHeight ? {
          wallHeight: {
            wallHeightBottom: levelRange[0],
            wallHeightTop: levelRange[1]
          }
        } : {},
        door: game.settings.get("dd-import", "openableWindows") ?  1 : (door.closed ? 1 : 0), // If openable windows - all portals should be doors, otherwise, only portals that "block light" should be openable (doors)
        sense: (door.closed) ? CONST.WALL_SENSE_TYPES.NORMAL : CONST.WALL_SENSE_TYPES.NONE
      }))
    }

    return doors
  }

  static GetLights(file, scene, levelRange, haveLevels) {
    let lights = [];
    let sceneDimensions = Canvas.getDimensions(scene.data)
    let offsetX = sceneDimensions.paddingX;
    let offsetY = sceneDimensions.paddingY;
    for (let light of file.lights) {
      let newLight = new AmbientLightDocument({
        t: "l",
        x: (light.position.x * file.resolution.pixels_per_grid) + offsetX,
        y: (light.position.y * file.resolution.pixels_per_grid) + offsetY,
        rotation: 0,
        dim: light.range * 4,
        bright: light.range * 2,
        angle: 360,
        tintColor: "#" + light.color.substring(2),
        tintAlpha: (0.05 * light.intensity),
        flags: haveLevels ? {
          levels: {
            rangeBottom: levelRange[0],
            rangeTop: levelRange[1]
          }
        } : {}
      })
      lights.push(newLight.data);
    }
    return lights;
  }
}
