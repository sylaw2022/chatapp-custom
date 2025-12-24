# Fix: Subsequent Video Calls Only Show One Party After Caller Ends Call

## Problem

When a video call is ended by the caller, subsequent video calls only show one party's video. This indicates that cleanup from the previous call is incomplete, leaving stale state that interferes with new calls.

## Root Cause

The `cleanup` function was not properly removing the window event listener for 'call-rejected' that was added in `initiateCall`. This listener was stored in `senderNotificationChannelRef.current` but was never cleaned up, causing:

1. **Stale event listeners**: Old listeners from previous calls could interfere with new calls
2. **Stale closures**: The event handler might have stale references to old call state
3. **Memory leaks**: Event listeners accumulating over multiple calls

## Solution

### Fix 1: Clean up window event listener
Added proper cleanup of the window event listener in the `cleanup` function:

```typescript
// CRITICAL: Clean up window event listener for call-rejected
if (senderNotificationChannelRef.current) {
  const handler = (senderNotificationChannelRef.current as any)?.rejectionHandler;
  if (handler) {
    console.log('🧹 Removing window event listener for call-rejected');
    window.removeEventListener('call-rejected', handler as EventListener);
    (senderNotificationChannelRef.current as any).rejectionHandler = null;
  }
  senderNotificationChannelRef.current = null;
}
```

### Fix 2: Ensure handleSignalRef is initialized before channel setup
Added a check to ensure `handleSignalRef.current` is set before setting up channel handlers. This prevents a race condition where the channel handlers are set up before `handleSignal` is available:

```typescript
// CRITICAL: Ensure handleSignalRef is set before setting up channel handlers
// This prevents race condition where handlers are set up before handleSignal is available
if (!handleSignalRef.current) {
  console.warn('⚠️ handleSignalRef is null, setting it now');
  handleSignalRef.current = handleSignal;
}
```

This check is added in:
- `initiateCall` function (when caller starts a call)
- `joinCall` function (when user manually joins)
- Auto-join useEffect (when accepting incoming call)

## Changes Made

1. **Added window event listener cleanup** in `cleanup` function (after notification channel cleanup)
2. **Added `handleSignalRef` initialization check** before setting up channel handlers in:
   - `initiateCall` function
   - `joinCall` function  
   - Auto-join useEffect
3. **Added error logging** when `handleSignalRef` is null during signal handling
4. **Added logging** to track cleanup process
5. **Ensured `handleSignalRef` is cleared** in cleanup (already present, but important for preventing stale closures)

## Root Causes

1. **Stale window event listeners**: The window event listener for 'call-rejected' wasn't being removed, causing interference with new calls
2. **Race condition with handleSignalRef**: When cleanup happened and a new call started immediately, `handleSignalRef.current` could be null when channel handlers were set up, causing signals to be ignored

## Testing

To verify the fix:
1. Start a video call as caller
2. End the call as caller
3. Start a new video call
4. Both parties should see each other's video

## Additional Notes

The `initiateCall` function already has logic to remove existing listeners before adding new ones (lines 703-709), but this is a safety measure. The proper cleanup in the `cleanup` function ensures that listeners are always removed when a call ends, preventing accumulation of stale listeners.

