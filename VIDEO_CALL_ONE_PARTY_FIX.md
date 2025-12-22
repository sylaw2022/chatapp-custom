# Video Call Issue: Only One Party's Video Shows

## Problem Analysis

After examining the `VideoCall.tsx` component, I've identified several potential causes for why only one party's video sometimes appears:

### Issue 1: Track Handling in `ontrack` Event
**Location:** `components/VideoCall.tsx` lines 1036-1087

**Problem:**
- When `ontrack` fires, it creates a `remoteStream` from `e.streams[0]` or a new empty `MediaStream()`
- If `e.streams[0]` exists but is empty, or if tracks arrive in separate events, the stream might not have all tracks
- The code merges tracks into existing streams, but if the stream reference doesn't change, React might not re-render the `VideoPlayer` component

**Root Cause:**
```typescript
const remoteStream = e.streams[0] || new MediaStream();
```
This creates a stream from the first stream in the event, but WebRTC can fire multiple `ontrack` events for the same peer, each with different tracks. If we always use `e.streams[0]`, we might miss tracks from subsequent events.

### Issue 2: VideoPlayer Component Not Updating
**Location:** `components/VideoCall.tsx` lines 39-94

**Problem:**
- The `VideoPlayer` component's `useEffect` depends on `peer.stream`
- When tracks are added to an existing stream (via `addTrack`), the stream object reference doesn't change
- React won't re-render because the dependency hasn't changed
- The video element's `srcObject` won't update even though new tracks were added

**Root Cause:**
```typescript
useEffect(() => {
  if (videoRef.current && peer.stream) {
    videoRef.current.srcObject = peer.stream;
    videoRef.current.play().catch(e => console.warn('Video play failed:', e));
  }
}, [peer.stream, peer.isLocal, peer.id]);
```
If `peer.stream` is the same object reference (even with new tracks added), this effect won't run again.

### Issue 3: Race Condition in Offer/Answer Exchange
**Location:** `components/VideoCall.tsx` lines 1149-1205

**Problem:**
- When a peer joins, the code creates an offer immediately
- However, if tracks haven't been fully added to the peer connection yet, the SDP might not include all tracks
- This can happen if `createPeer` is called but tracks are added asynchronously

**Root Cause:**
The offer is created right after `createPeer`, but `addTrack` might not have completed, or the peer connection might not be ready.

### Issue 4: Stream Reference Not Updating in State
**Location:** `components/VideoCall.tsx` lines 1064-1071

**Problem:**
- When tracks are merged into an existing stream, the code does:
  ```typescript
  const newPeers = new Map(prev).set(remoteId, { ...existing, stream: existing.stream });
  ```
- This keeps the same stream reference, so React won't detect a change
- The `VideoPlayer` component won't update even though tracks were added

## Solutions

### Fix 1: Properly Handle Multiple Track Events
Instead of always using `e.streams[0]`, we should:
1. Check if we already have a stream for this peer
2. If yes, add tracks from all streams in the event to the existing stream
3. If no, create a new stream and add all tracks from all streams in the event

### Fix 2: Force VideoPlayer Update When Tracks Change
We need to:
1. Track the number of tracks in the stream
2. Include track count in the dependency array or use a different approach
3. Or, create a new stream object when tracks are added (clone the stream)

### Fix 3: Ensure Tracks Are Added Before Creating Offer
We should:
1. Wait for tracks to be added before creating the offer
2. Or, use `onnegotiationneeded` event to create offers when tracks are ready

### Fix 4: Create New Stream Reference When Tracks Are Added
When merging tracks, create a new MediaStream object to ensure React detects the change.

## Implementation

The fixes implemented:
1. ✅ Properly aggregate all tracks from all `ontrack` events - Now collects tracks from all streams in the event
2. ✅ Create new stream references when tracks are added - Creates a new MediaStream object when tracks are merged, ensuring React detects the change
3. ✅ Enhanced VideoPlayer component - Tracks track count changes and always updates srcObject even if stream reference doesn't change
4. ✅ Better logging - Added comprehensive logging to debug track issues

## Changes Made

### 1. VideoPlayer Component (lines 39-94)
- Added `trackCountRef` to track the number of video/audio tracks
- Always updates `srcObject` even if stream reference doesn't change
- Detects track count changes to trigger updates
- Better logging for debugging

### 2. ontrack Handler (lines 1036-1123)
- **Fixed**: Now aggregates ALL tracks from ALL streams in the event (not just `e.streams[0]`)
- **Fixed**: Creates a NEW MediaStream object when merging tracks (instead of reusing the same reference)
- **Fixed**: Properly handles the case where tracks arrive in separate `ontrack` events
- **Fixed**: Better logging to track track additions and stream state

### Key Fix: New Stream Reference
The critical fix is creating a new MediaStream when tracks are added:
```typescript
// OLD (didn't trigger React update):
existing.stream.addTrack(track);
const newPeers = new Map(prev).set(remoteId, { ...existing, stream: existing.stream });

// NEW (triggers React update):
const updatedStream = new MediaStream();
existing.stream.getTracks().forEach(track => updatedStream.addTrack(track));
newTracks.forEach(track => updatedStream.addTrack(track));
const newPeers = new Map(prev).set(remoteId, { ...existing, stream: updatedStream });
```

This ensures React's `VideoPlayer` component re-renders and updates the video element when new tracks arrive.

## Testing Recommendations

1. **Test with both parties initiating calls** - Ensure video shows for both caller and receiver
2. **Test with different network conditions** - Tracks might arrive at different times
3. **Test with audio-only calls** - Ensure audio works even if video doesn't
4. **Monitor browser console** - Look for the new logging messages to verify track handling
5. **Test on different browsers** - Chrome, Firefox, Safari may handle WebRTC differently

## Expected Behavior After Fix

- Both parties should see each other's video when video calls are initiated
- Tracks arriving in separate events should be properly aggregated
- Video elements should update when new tracks are added
- Console logs should show track additions and stream updates

