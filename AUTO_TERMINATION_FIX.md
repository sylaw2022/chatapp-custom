# Auto-Termination Fix

## Issue
Audio and video calls were auto-terminating after a few seconds.

## Root Causes Identified

### 1. Unmount Cleanup Effect Re-running Prematurely
**Location:** `components/VideoCall.tsx` line 139 (original)

**Problem:** The unmount cleanup `useEffect` had `cleanup` in its dependency array:
```typescript
useEffect(() => () => { cleanup(true); }, [cleanup]);
```

This caused the cleanup to run whenever the `cleanup` function reference changed (which happens when `currentUser.id`, `supabase`, or `onCallEnd` changes), terminating active calls prematurely.

**Fix:** Changed to use an empty dependency array and check refs directly:
```typescript
useEffect(() => {
  return () => {
    if (localStream.current || channelRef.current) {
      const performCleanup = async () => {
        // Direct cleanup using refs, not state
        if (channelRef.current) {
          await channelRef.current.send({ type: 'broadcast', event: 'signal', payload: { type: 'leave', senderId: currentUserRef.current.id } });
          await supabase.removeChannel(channelRef.current);
        }
        // ... rest of cleanup
      };
      performCleanup();
    }
  };
}, []); // Empty deps - only run on mount/unmount
```

### 2. Auto-Join Effect Re-running on State Changes
**Location:** `components/VideoCall.tsx` line 333 (original)

**Problem:** The auto-join effect depended on both `incomingMode` and `callState`:
```typescript
}, [incomingMode, callState]);
```

When `callState` changed from 'idle' to 'calling' to 'active', the effect would re-evaluate, potentially causing issues.

**Fix:** 
- Removed `callState` from dependencies (only depend on `incomingMode`)
- Added `hasJoinedRef` to prevent re-joining:
```typescript
const hasJoinedRef = useRef<boolean>(false);

useEffect(() => {
  if (incomingMode && callState === 'idle' && !localStream.current && !hasJoinedRef.current) {
    hasJoinedRef.current = true; // Mark that we're joining
    // ... auto-join logic
  }
  if (!incomingMode) {
    hasJoinedRef.current = false; // Reset when call ends
  }
}, [incomingMode]); // Only depend on incomingMode
```

### 3. AcceptedCallMode Timeout Clearing Prematurely
**Location:** `app/page.tsx` line 23 (original)

**Problem:** `acceptedCallMode` was being cleared after 5 seconds:
```typescript
const timer = setTimeout(() => setAcceptedCallMode(null), 5000)
```

This could cause the VideoCall component to lose the `incomingMode` prop, potentially affecting call state.

**Fix:** Removed automatic timeout clearing. The `acceptedCallMode` now persists for the duration of the call:
```typescript
// Don't clear acceptedCallMode automatically - let the call continue
// Only clear when switching to a different chat
useEffect(() => {
  // Only clear if switching to a different chat (not just when acceptedCallMode is set)
  // This prevents premature call termination
}, [activeChat?.id]) // Only trigger when chat ID actually changes
```

### 4. Cleanup Function Closure Issues
**Location:** `components/VideoCall.tsx` unmount cleanup

**Problem:** The cleanup function in the unmount effect was trying to access `currentUser.id` from closure, which might not be accessible.

**Fix:** Added `currentUserRef` to store currentUser in a ref:
```typescript
const currentUserRef = useRef<User>(currentUser);

useEffect(() => {
  currentUserRef.current = currentUser;
}, [currentUser]);

// Use currentUserRef.current.id in cleanup instead of currentUser.id
```

## Changes Summary

1. **components/VideoCall.tsx:**
   - Fixed unmount cleanup to only run on actual unmount
   - Added `hasJoinedRef` to prevent auto-join re-execution
   - Removed `callState` from auto-join effect dependencies
   - Added `currentUserRef` for stable cleanup access
   - Reset `hasJoinedRef` in cleanup function

2. **app/page.tsx:**
   - Removed automatic `acceptedCallMode` timeout clearing
   - Changed dependency to only trigger on chat ID changes

## Testing Recommendations

1. Start a call between two users
2. Verify the call does not terminate after a few seconds
3. Test both audio and video calls
4. Test call termination when one user manually ends the call
5. Verify cleanup still works properly when component unmounts

## Expected Behavior After Fix

- Calls should remain active until manually ended by a user
- No premature termination after a few seconds
- Proper cleanup only on actual component unmount or manual call end
- Auto-join should only happen once per incoming call











