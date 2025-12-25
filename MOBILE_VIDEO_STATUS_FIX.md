# Mobile Browser Video and Status Fix

## Issue
After a mobile browser answers a video call:
1. No video is showing
2. Status is not showing "call in progress"

## Root Causes Identified

### 1. CallState Not Updated After Answer
**Location:** `components/VideoCall.tsx` answer handling

**Problem:** When a mobile browser answers a call, the answer is received and processed, but the `callState` is not updated to 'active' on the caller side. This causes the UI to still show "Connecting..." instead of "Live" and the call status doesn't reflect that the call is active.

**Fix:** Added callState updates when answer is received:
```typescript
// In answer handling (have-local-offer state)
await pc.setRemoteDescription(new RTCSessionDescription(sdp));
setCallState(prev => {
  if (prev !== 'active') {
    console.log('Updating callState to active after receiving answer');
    return 'active';
  }
  return prev;
});

// In answer handling (stable state - mobile edge case)
await pc.setRemoteDescription(new RTCSessionDescription(sdp));
setCallState(prev => {
  if (prev !== 'active') {
    console.log('Updating callState to active after receiving answer (stable state)');
    return 'active';
  }
  return prev;
});
```

### 2. CallState Not Updated When Remote Tracks Received
**Location:** `components/VideoCall.tsx` ontrack handler

**Problem:** When remote video/audio tracks are received via the `ontrack` event, the callState is not updated to 'active', even though the call is now established and media is flowing.

**Fix:** Added callState update when first remote peer/track is received:
```typescript
pc.ontrack = e => {
  // ... track handling logic ...
  setPeers(prev => {
    const existing = prev.get(remoteId);
    const wasEmpty = prev.size === 0 || (prev.size === 1 && prev.has(currentUser.id));
    
    if (existing && existing.stream) {
      // ... merge tracks ...
      if (tracksAdded) {
        const newPeers = new Map(prev).set(remoteId, { ...existing, stream: existing.stream });
        // Update call state to active when first remote track is received
        if (wasEmpty) {
          console.log('Updating callState to active after receiving first remote track');
          setCallState('active');
        }
        return newPeers;
      }
    } else {
      // Create new peer entry
      const newPeers = new Map(prev).set(remoteId, { id: remoteId, stream: remoteStream, user, isLocal: false });
      // Update call state to active when first remote peer is added
      if (wasEmpty) {
        console.log('Updating callState to active after adding first remote peer');
        setCallState('active');
      }
      return newPeers;
    }
  });
};
```

### 3. CallState Not Updated on Connection Established
**Location:** `components/VideoCall.tsx` connection state handler

**Problem:** When the WebRTC connection state changes to 'connected', the callState is not updated to reflect that the call is now active.

**Fix:** Added callState update when connection is established:
```typescript
pc.onconnectionstatechange = () => {
  console.log(`Connection state for ${remoteId}:`, pc.connectionState);
  if (pc.connectionState === 'connected') {
    console.log(`Successfully connected to peer ${remoteId}`);
    // Update call state to active when connection is established
    setCallState(prev => {
      if (prev !== 'active') {
        console.log('Updating callState to active after connection established');
        return 'active';
      }
      return prev;
    });
  }
  // ... other state handling ...
};
```

## Changes Summary

1. **components/VideoCall.tsx:**
   - Added callState update when answer is received (both normal and stable state cases)
   - Added callState update when first remote track/peer is received via ontrack
   - Added callState update when connection state becomes 'connected'
   - Used functional updates (`setCallState(prev => ...)`) to avoid stale closure issues

## UI Impact

The UI shows:
- **Status:** "Connecting..." when `callState === 'calling'`
- **Status:** "Live" when `callState === 'active'`
- **Video:** Remote video appears when peers Map contains remote peer entries

After these fixes:
- Status will update to "Live" when answer is received
- Status will update to "Live" when remote tracks are received
- Status will update to "Live" when connection is established
- Video will appear when remote tracks are received and added to peers Map

## Testing Recommendations

1. Start a video call from desktop to mobile browser
2. Have mobile browser answer the call
3. Verify status changes from "Connecting..." to "Live" on both sides
4. Verify remote video appears on both sides
5. Check browser console for callState update logs
6. Test with different mobile browsers (Chrome, Safari, Firefox)

## Expected Behavior After Fix

- Status should show "Live" after mobile browser answers
- Remote video should appear after answer is processed
- Call state should be 'active' on both caller and receiver sides
- UI should reflect active call state with proper status and video display

## Debugging

If issues persist, check browser console for:
- "Updating callState to active after receiving answer" - indicates answer processing
- "Updating callState to active after receiving first remote track" - indicates track reception
- "Updating callState to active after connection established" - indicates connection success
- "Received track from X" - indicates remote tracks are being received
- "Creating new peer entry for X" - indicates remote peer is being added











