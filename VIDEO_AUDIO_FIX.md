# Video and Audio Call Fix

## Issues Reported
1. Video call only showing 1 party's video (only local video, not remote)
2. No audio in calls

## Root Causes Identified

### 1. Ontrack Handler Not Properly Updating State
**Location:** `components/VideoCall.tsx` line 426

**Problem:** The `ontrack` event handler was setting the peer, but when merging tracks into an existing stream, it wasn't properly triggering React re-renders because it was returning the same Map reference.

**Fix:** 
- Improved track merging logic to properly create new Map instances when tracks are added
- Added logging to track when tracks are received
- Ensured that when tracks are merged, a new Map is returned to trigger re-render

```typescript
pc.ontrack = e => {
  console.log(`Received track from ${remoteId}:`, e.track.kind, e.streams, 'Track enabled:', e.track.enabled);
  const remoteStream = e.streams[0] || new MediaStream();
  
  setPeers(prev => {
    const existing = prev.get(remoteId);
    if (existing && existing.stream) {
      // Merge tracks from new stream into existing stream
      let tracksAdded = false;
      e.streams.forEach(stream => {
        stream.getTracks().forEach(track => {
          const existingTrack = existing.stream.getTracks().find(
            t => t.id === track.id || (t.kind === track.kind && t.label === track.label)
          );
          if (!existingTrack) {
            existing.stream.addTrack(track);
            tracksAdded = true;
            console.log(`Added ${track.kind} track to existing stream for ${remoteId}`);
          }
        });
      });
      // Return new Map to trigger re-render if tracks were added
      if (tracksAdded) {
        return new Map(prev).set(remoteId, { ...existing, stream: existing.stream });
      }
      return prev;
    } else {
      // Create new peer entry
      console.log(`Creating new peer entry for ${remoteId} with stream tracks:`, remoteStream.getTracks().map(t => t.kind));
      return new Map(prev).set(remoteId, { id: remoteId, stream: remoteStream, user, isLocal: false });
    }
  });
};
```

### 2. Audio Element Not Properly Configured
**Location:** `components/VideoCall.tsx` VideoPlayer component

**Problem:** 
- Audio element might not be playing automatically
- Audio element might be muted or volume set incorrectly
- Audio stream might not be properly assigned

**Fix:**
- Added explicit `muted={false}` to audio element
- Added volume and play() calls in useEffect
- Added logging to track audio setup

```typescript
useEffect(() => {
  if (videoRef.current && peer.stream) {
    videoRef.current.srcObject = peer.stream;
    videoRef.current.play().catch(e => console.warn('Video play failed:', e));
  }
  // CRITICAL: Add audio element for remote streams to hear audio
  if (!peer.isLocal && audioRef.current && peer.stream) {
    audioRef.current.srcObject = peer.stream;
    // Ensure audio is not muted and force play
    audioRef.current.muted = false;
    audioRef.current.volume = 1.0;
    audioRef.current.play().catch(e => console.warn('Audio play failed:', e));
    console.log(`Audio element set for remote peer ${peer.id}, tracks:`, peer.stream.getAudioTracks().length);
  }
}, [peer.stream, peer.isLocal, peer.id]);
```

### 3. Offer/Answer Creation Without Track Verification
**Location:** `components/VideoCall.tsx` handleSignal function

**Problem:** Offers and answers were being created without verifying that local stream tracks were available, which could result in incomplete SDP.

**Fix:**
- Added checks to ensure local stream has tracks before creating offer/answer
- Added logging to track SDP creation

```typescript
// In offer creation:
if (localStream.current && localStream.current.getTracks().length > 0) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log(`Created offer for ${senderId}, tracks in SDP:`, localStream.current.getTracks().map(t => t.kind));
  channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: pc.localDescription, senderId: currentUser.id, targetId: senderId } });
} else {
  console.warn('Cannot create offer: no local stream tracks available');
}

// In answer creation:
if (localStream.current && localStream.current.getTracks().length > 0) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  console.log(`Created answer for ${senderId}, tracks in SDP:`, localStream.current.getTracks().map(t => t.kind));
  channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: pc.localDescription, senderId: currentUser.id, targetId: senderId } });
} else {
  console.warn('Cannot create answer: no local stream tracks available');
}
```

## Changes Summary

1. **components/VideoCall.tsx:**
   - Improved `ontrack` handler to properly merge tracks and trigger re-renders
   - Enhanced audio element setup with explicit muted/volume settings and play() calls
   - Added track verification before creating offers/answers
   - Added comprehensive logging for debugging

## Testing Recommendations

1. Start a video call between two users
2. Verify both users can see each other's video
3. Verify both users can hear each other's audio
4. Check browser console for track and SDP logging
5. Test with audio-only calls
6. Test with video calls where one user has camera off

## Expected Behavior After Fix

- Both parties should see each other's video (if video is enabled)
- Both parties should hear each other's audio
- Remote streams should appear in the peers Map
- Audio elements should automatically play remote audio
- Console should show track reception and SDP creation logs

## Debugging

If issues persist, check browser console for:
- "Received track from X" messages - indicates tracks are being received
- "Created offer/answer for X" messages - indicates SDP is being created
- "Audio element set for remote peer X" messages - indicates audio setup
- Any errors related to play() or track handling











