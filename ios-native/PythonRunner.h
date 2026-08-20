#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Starts the embedded CPython runtime (Python.xcframework, wired in by
/// dev/lib/native-packaging/build-ios-ci.sh) and the Soberan backend on a background
/// thread. Safe to call more than once — backend/ios_launcher.py's start() is idempotent.
@interface PythonRunner : NSObject
+ (void)start;
@end

NS_ASSUME_NONNULL_END
