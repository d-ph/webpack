/**
 * @typedef {Object} WebpackWatchIgnorePluginIgnoredItem
 * @property {string} type "path" | "entry-point"
 * @property {string} data For type "path" it's a regexp or absolute path. For type "entry-point"
 *                         it's an entry point name.
 */

/**
 * @param {string[]|WebpackWatchIgnorePluginIgnoredItem[]} ignoreItemsOrPaths
 */
function WatchIgnorePlugin(ignoreItemsOrPaths) {
    this.paths = [];
    this.entryPoints = [];

    ignoreItemsOrPaths.forEach(function (item) {
        if (typeof(item) === "string") {
            this.paths.push(item);
            return;
        }

        switch (true) {
            case item.type === "path":
                this.paths.push(item.data);
                break;

            case item.type === "entry-point":
                this.entryPoints.push(item.data);
                break;

            default:
                throw new Error(`WatchIgnorePlugin: '${item.type}' is not a recognised WatchIgnorePlugin config item type.`);
        }

    }.bind(this));
}

module.exports = WatchIgnorePlugin;

WatchIgnorePlugin.prototype.apply = function(compiler) {
    var moduleIgnoringModuleFactoryPlugin = new ModuleIgnoringModuleFactoryPlugin(compiler.options.context);
    var hasAlreadyMarkedIgnoredModules = false;

    compiler.plugin("after-environment", function() {
		compiler.watchFileSystem = new IgnoringWatchFileSystem(compiler.watchFileSystem, this.paths);
	}.bind(this));

    compiler.plugin("compile", function(params) {
        params.normalModuleFactory.apply(moduleIgnoringModuleFactoryPlugin);
    }.bind(this));

    compiler.plugin('emit', function(compilation, callback) {
        if (hasAlreadyMarkedIgnoredModules) {
            callback();
            return;
        }

        this.entryPoints.forEach(function (entryPointChunkName) {
            if (!compilation.namedChunks[entryPointChunkName]) {
                throw new Error(`WatchIgnorePlugin: '${entryPointChunkName}' entry point couldn't be found in the list of chunks. Available chunks: ${Object.keys(compilation.namedChunks).join(', ')}`);
            }

            compilation.namedChunks[entryPointChunkName].modules.forEach(function (module) {
                moduleIgnoringModuleFactoryPlugin.addModuleToIgnoreList(module);
            });
        });

        hasAlreadyMarkedIgnoredModules = true;

        callback();
    }.bind(this));
};

function ModuleIgnoringModuleFactoryPlugin(context) {
    /** @type {string[]} */
    this.ignoredModulesIdents = [];
    this.context = context;
}

ModuleIgnoringModuleFactoryPlugin.prototype.apply = function (normalModuleFactory) {
    normalModuleFactory.plugin("module", function (module) {
        if (module.libIdent) {
            var request = module.libIdent({ context: this.context });
            if (request && request in this.ignoredModulesIdents) {
                module.needRebuild = function () { return false; };
            }
        }
        return module;
    }.bind(this));
};

ModuleIgnoringModuleFactoryPlugin.prototype.addModuleToIgnoreList = function (module) {
    if (!module.libIdent) {
        return;
    }
    this.ignoredModulesIdents.push(module.libIdent({ context: this.context }));
};

function IgnoringWatchFileSystem(wfs, paths) {
	this.wfs = wfs;
	this.paths = paths;
}

IgnoringWatchFileSystem.prototype.watch = function(files, dirs, missing, startTime, options, callback, callbackUndelayed) {
	var ignored = function(path) {
		return this.paths.some(function(p) {
			return p instanceof RegExp ? p.test(path) : path.indexOf(p) === 0;
		});
	}.bind(this);

	var notIgnored = function(path) {
		return !ignored(path);
	};

	var ignoredFiles = files.filter(ignored);
	var ignoredDirs = dirs.filter(ignored);

	this.wfs.watch(files.filter(notIgnored), dirs.filter(notIgnored), missing, startTime, options, function(err, filesModified, dirsModified, missingModified, fileTimestamps, dirTimestamps) {
		if(err) return callback(err);

		ignoredFiles.forEach(function(path) {
			fileTimestamps[path] = 1;
		});

		ignoredDirs.forEach(function(path) {
			dirTimestamps[path] = 1;
		});

		callback(err, filesModified, dirsModified, missingModified, fileTimestamps, dirTimestamps);
	}, callbackUndelayed);
};
