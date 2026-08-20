#import "PythonRunner.h"
#import <Python/Python.h>

// Mirrors the Python-initialization dance from CPython's own iOS testbed
// (Python-Apple-support's testbed/TestbedTests/TestbedTests.m) — that's the reference
// implementation this was adapted from, verified working in a from-source build spike
// before this file was written. Differences from the testbed: this runs on a background
// GCD queue instead of blocking a test thread, never calls Py_Finalize (the interpreter
// needs to stay alive for the app's lifetime), and calls ios_launcher.start() instead of
// Py_RunMain() — see backend/ios_launcher.py's start() docstring for why that call blocks
// this queue for the rest of the app's life instead of spawning its own Python thread
// (short version: a plain threading.Thread never actually runs its target on this build,
// confirmed directly — this queue, already off the UI thread, is the fix).
@implementation PythonRunner

+ (void)start {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
            [self bootstrapAndStart];
        });
    });
}

+ (void)bootstrapAndStart {
    NSString *resourcePath = [[NSBundle mainBundle] resourcePath];

    setenv("NO_COLOR", "1", true);
    setenv("PYTHON_COLORS", "0", true);

    PyPreConfig preconfig;
    PyPreConfig_InitIsolatedConfig(&preconfig);
    preconfig.utf8_mode = 1;

    PyStatus status = Py_PreInitialize(&preconfig);
    if (PyStatus_Exception(status)) {
        NSLog(@"PythonRunner: pre-init failed: %s", status.err_msg);
        return;
    }

    PyConfig config;
    PyConfig_InitIsolatedConfig(&config);
    config.buffered_stdio = 0;
    // Can't write bytecode into a signed, read-only app bundle.
    config.write_bytecode = 0;
    // Python's own iOS embedding docs (docs.python.org/using/ios.html) say this should be
    // *enabled* for embedded interpreters — left disabled here originally by mistake,
    // copied from a context where it didn't matter.
    config.install_signal_handlers = 1;

    NSString *pythonHome = [NSString stringWithFormat:@"%@/python", resourcePath];
    wchar_t *wHome = Py_DecodeLocale([pythonHome UTF8String], NULL);
    status = PyConfig_SetString(&config, &config.home, wHome);
    PyMem_RawFree(wHome);
    if (PyStatus_Exception(status)) {
        NSLog(@"PythonRunner: setting home failed: %s", status.err_msg);
        PyConfig_Clear(&config);
        return;
    }

    status = PyConfig_Read(&config);
    if (PyStatus_Exception(status)) {
        NSLog(@"PythonRunner: config read failed: %s", status.err_msg);
        PyConfig_Clear(&config);
        return;
    }

    status = Py_InitializeFromConfig(&config);
    PyConfig_Clear(&config);
    if (PyStatus_Exception(status)) {
        NSLog(@"PythonRunner: init failed: %s", status.err_msg);
        return;
    }

    // app_packages: pip-installed backend deps (our own numpy/pydantic-core iOS wheels +
    // everything pure-Python from requirements-desktop.txt) — added via site.addsitedir so
    // any .pth files in there also run, same as the testbed.
    PyObject *siteModule = PyImport_ImportModule("site");
    if (siteModule == NULL) {
        NSLog(@"PythonRunner: could not import site module");
        PyErr_Print();
        return;
    }
    PyObject *addsitedir = PyObject_GetAttrString(siteModule, "addsitedir");
    Py_DECREF(siteModule);
    if (addsitedir == NULL || !PyCallable_Check(addsitedir)) {
        NSLog(@"PythonRunner: could not access site.addsitedir");
        return;
    }
    NSString *appPackagesPath = [NSString stringWithFormat:@"%@/app_packages", resourcePath];
    PyObject *appPackagesArgs = Py_BuildValue("(s)", [appPackagesPath UTF8String]);
    PyObject *addsiteResult = PyObject_CallObject(addsitedir, appPackagesArgs);
    Py_DECREF(addsitedir);
    Py_DECREF(appPackagesArgs);
    if (addsiteResult == NULL) {
        NSLog(@"PythonRunner: site.addsitedir(app_packages) failed");
        PyErr_Print();
        return;
    }
    Py_DECREF(addsiteResult);

    // pysrc: our own backend source (app/, alembic/, alembic.ini, ios_launcher.py) — plain
    // sys.path insert, not a site directory (it's source, not installed packages). Named
    // "pysrc", not "app" — APFS is case-insensitive by default, and "app" collides with
    // this bundle's own executable ("App.app/App", PRODUCT_NAME = App), which fails the
    // link step with a baffling "Is a directory" error (found the hard way).
    PyObject *sysModule = PyImport_ImportModule("sys");
    PyObject *sysPath = PyObject_GetAttrString(sysModule, "path");
    Py_DECREF(sysModule);
    NSString *appPath = [NSString stringWithFormat:@"%@/pysrc", resourcePath];
    PyList_Insert(sysPath, 0, PyUnicode_FromString([appPath UTF8String]));
    Py_DECREF(sysPath);
    chdir([appPath UTF8String]);

    // Writable, app-private directory for the SQLite DB — Application Support inside this
    // app's sandboxed container, created if it doesn't exist yet.
    NSArray<NSString *> *appSupportDirs = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
    NSString *dataRoot = appSupportDirs.firstObject;
    [[NSFileManager defaultManager] createDirectoryAtPath:dataRoot withIntermediateDirectories:YES attributes:nil error:nil];

    PyObject *iosLauncher = PyImport_ImportModule("ios_launcher");
    if (iosLauncher == NULL) {
        NSLog(@"PythonRunner: could not import ios_launcher");
        PyErr_Print();
        return;
    }
    PyObject *startFn = PyObject_GetAttrString(iosLauncher, "start");
    Py_DECREF(iosLauncher);
    if (startFn == NULL || !PyCallable_Check(startFn)) {
        NSLog(@"PythonRunner: could not access ios_launcher.start");
        return;
    }
    // Blocks this queue for the rest of the app's life (see the docstring in
    // ios_launcher.py) — nothing after this line runs unless the backend fails to start.
    NSLog(@"PythonRunner: starting backend on http://127.0.0.1:17890");
    PyObject *startArgs = Py_BuildValue("(s)", [dataRoot UTF8String]);
    PyObject *startResult = PyObject_CallObject(startFn, startArgs);
    Py_DECREF(startFn);
    Py_DECREF(startArgs);
    if (startResult == NULL) {
        NSLog(@"PythonRunner: ios_launcher.start() failed");
        PyErr_Print();
        return;
    }
    Py_DECREF(startResult);
}

@end
