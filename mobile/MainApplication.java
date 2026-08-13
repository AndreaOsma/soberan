package com.andreaosma.soberan;

import android.app.Application;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

public class MainApplication extends Application {
    private static final String TAG = "SoberanBackend";

    @Override
    public void onCreate() {
        super.onCreate();
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }
        try {
            Python py = Python.getInstance();
            PyObject launcher = py.getModule("mobile_launcher");
            PyObject url = launcher.callAttr("start", getFilesDir().getAbsolutePath());
            Log.i(TAG, "Backend starting at " + url.toString());
        } catch (Exception e) {
            Log.e(TAG, "Failed to start on-device backend", e);
        }
    }
}
