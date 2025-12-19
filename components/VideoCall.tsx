'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { User } from '@/types'
import { Phone, PhoneOff, Video as VideoIcon, VideoOff, Mic, MicOff } from 'lucide-react'

// --- CONFIG & TYPES ---
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN servers - Add your TURN server credentials here
    // For production, use environment variables:
    ...(process.env.NEXT_PUBLIC_TURN_URL ? [{
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || '',
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || ''
    }] : [])
  ],
  iceCandidatePoolSize: 10
}

interface Peer {
  id: number;
  stream: MediaStream;
  user: User;
  isLocal?: boolean;
}

interface VideoCallProps {
  currentUser: User;
  activeChat: any;
  isGroup: boolean;
  incomingMode?: 'audio' | 'video' | null;
  onCallEnd: () => void;
}

// --- UNIFIED VIDEO PLAYER SUB-COMPONENT ---
const VideoPlayer = ({ peer }: { peer: Peer }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
      // Force video to play
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

  const isVideoEnabled = peer.stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled);

  return (
    <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-inner flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={peer.isLocal} // Critical: Only mute your own video to prevent echo
        className={`w-full h-full object-cover ${peer.isLocal ? 'transform scale-x-[-1]' : ''} ${!isVideoEnabled ? 'hidden' : ''}`}
      />
      {/* Audio element for remote streams - CRITICAL for hearing audio */}
      {!peer.isLocal && (
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          muted={false}
        />
      )}
      {!isVideoEnabled && (
        <div className="flex flex-col items-center gap-2">
          {peer.user?.avatar && <img src={peer.user.avatar} className="w-16 h-16 rounded-full border-2 border-blue-500" alt={peer.user.nickname} />}
          <span className="text-sm text-gray-300">{peer.isLocal ? 'You' : peer.user?.nickname}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
        {peer.isLocal ? 'You' : peer.user?.nickname}
        {(!peer.stream?.getAudioTracks().some(track => track.enabled)) &&
          <MicOff size={14} className="ml-2 text-red-400" />
        }
      </div>
    </div>
  );
};


// --- MAIN VIDEO CALL COMPONENT (REWRITTEN TO PREVENT RACE CONDITIONS) ---
export default function VideoCall({ currentUser, activeChat, isGroup, incomingMode, onCallEnd }: VideoCallProps) {
  const [callState, setCallState] = useState<'idle' | 'calling' | 'active'>('idle');
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [peers, setPeers] = useState<Map<number, Peer>>(new Map());
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  
  const localStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<number, RTCPeerConnection>>(new Map());
  const channelRef = useRef<any>(null);
  const notifyChannelRef = useRef<any>(null);
  const iceCandidateQueue = useRef<Map<number, RTCIceCandidate[]>>(new Map());
  const handleSignalRef = useRef<any>(null);
  const pendingOffers = useRef<Set<number>>(new Set()); // Track peers we're creating offers for
  const hasJoinedRef = useRef<boolean>(false); // Track if we've already joined to prevent re-joining
  const currentUserRef = useRef<User>(currentUser); // Store currentUser in ref for cleanup
  const supabase = createClient();
  
  // Keep currentUserRef in sync
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const roomId = `call-${isGroup ? `group-${activeChat.id}` : `dm-${[currentUser.id, activeChat.id].sort().join('-')}`}`;

  // --- CORE LOGIC: CLEANUP ---
  const cleanup = useCallback(async (isLeaving: boolean) => {
    if (isLeaving && channelRef.current) {
      try {
        await channelRef.current.send({ type: 'broadcast', event: 'signal', payload: { type: 'leave', senderId: currentUser.id } });
        await supabase.removeChannel(channelRef.current);
      } catch (e) { console.error("Error during cleanup send/remove:", e) }
    }
    
    // Cleanup notification channel
    if (notifyChannelRef.current) {
      try {
        await supabase.removeChannel(notifyChannelRef.current);
      } catch (e) { console.error("Error removing notification channel:", e) }
      notifyChannelRef.current = null;
    }
    
    channelRef.current = null;
    localStream.current?.getTracks().forEach(track => track.stop());
    localStream.current = null;
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    iceCandidateQueue.current.clear();
    pendingOffers.current.clear();
    hasJoinedRef.current = false; // Reset join flag
    setPeers(new Map());
    setCallState('idle');
    onCallEnd(); // Notify parent to reset state
  }, [currentUser.id, supabase, onCallEnd]);

  // --- CORE LOGIC: END CALL & UNMOUNT CLEANUP ---
  const handleEndCallClick = () => cleanup(true);
  
  // Only cleanup on actual unmount, not when cleanup function changes
  useEffect(() => {
    return () => {
      // Only cleanup if we're actually in a call (use refs, not state)
      if (localStream.current || channelRef.current) {
        // Use a stable reference to cleanup
        const performCleanup = async () => {
          if (channelRef.current) {
            try {
              await channelRef.current.send({ type: 'broadcast', event: 'signal', payload: { type: 'leave', senderId: currentUserRef.current.id } });
              await supabase.removeChannel(channelRef.current);
            } catch (e) { console.error("Error during cleanup send/remove:", e) }
          }
          if (notifyChannelRef.current) {
            try {
              await supabase.removeChannel(notifyChannelRef.current);
            } catch (e) { console.error("Error removing notification channel:", e) }
          }
          localStream.current?.getTracks().forEach(track => track.stop());
          peerConnections.current.forEach(pc => pc.close());
        };
        performCleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount/unmount

  // --- CORE LOGIC: INITIATE CALL (FROM BUTTON OR INCOMING NOTIFICATION) ---
  const initiateCall = useCallback(async (type: 'audio' | 'video', notify: boolean) => {
    // Check if already in a call
    if (callState !== 'idle' && localStream.current) {
      console.warn('Already in a call. End current call first.');
      return;
    }
    
    setCallType(type);
    setCallState('calling'); // Start calling immediately, no prompting
    
    // Send notification to receiver
    if (notify && !isGroup) {
      // Cleanup any existing notification channel
      if (notifyChannelRef.current) {
        supabase.removeChannel(notifyChannelRef.current);
      }
      
      notifyChannelRef.current = supabase.channel(`notifications-${activeChat.id}`);
      notifyChannelRef.current.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          notifyChannelRef.current.send({ type: 'broadcast', event: 'incoming-call', payload: { caller: currentUser, roomId, callType: type } });
          setTimeout(() => {
            if (notifyChannelRef.current) {
              supabase.removeChannel(notifyChannelRef.current);
              notifyChannelRef.current = null;
            }
          }, 10000);
        }
      });
    }
    
    // Auto-join the call immediately (no "Click to Join" needed)
    // Inline join logic to avoid dependency issues
    try {
      // Browser compatibility check
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
        await cleanup(false);
        return;
      }

      // This is the critical "Audio Unlock" step for cross-platform audio
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        await audio.play();
      } catch (e) {
        console.warn('Dummy audio play failed. Autoplay might not work.', e);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
      localStream.current = stream;
      
      const initialCameraOff = type === 'audio';
      setIsCameraOff(initialCameraOff);
      stream.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      setPeers(new Map([[currentUser.id, { id: currentUser.id, stream, isLocal: true, user: currentUser }]]));
      setCallState('active');

      const channel = supabase.channel(roomId);
      channelRef.current = channel;

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          // Use ref to access handleSignal to avoid dependency issues
          if (handleSignalRef.current) {
            handleSignalRef.current(payload, channel);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
          }
        });
    } catch (err: any) {
      console.error("Failed to get media:", err);
      let errorMessage = "Could not access Camera/Microphone. ";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += "Please allow camera/microphone access in your browser settings.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage += "No camera/microphone found. Please connect a device.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage += "Device is being used by another application.";
      } else {
        errorMessage += "Please check permissions and try again.";
      }
      alert(errorMessage);
      await cleanup(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, supabase, activeChat.id, currentUser, roomId, callState, cleanup]);
  
  // Auto-join when accepting incoming call
  useEffect(() => {
    if (incomingMode && callState === 'idle' && !localStream.current && !hasJoinedRef.current) {
      // For accepted incoming calls, auto-join instead of prompting
      hasJoinedRef.current = true; // Mark that we're joining
      const autoJoin = async () => {
        setCallType(incomingMode);
        setCallState('calling');
        
        // Browser compatibility check
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
          await cleanup(false);
          return;
        }

        // This is the critical "Audio Unlock" step for cross-platform audio
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
          await audio.play();
        } catch (e) {
          console.warn('Dummy audio play failed. Autoplay might not work.', e);
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: incomingMode === 'video', audio: true });
          localStream.current = stream;
          
          const initialCameraOff = incomingMode === 'audio';
          setIsCameraOff(initialCameraOff);
          stream.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
          
          setPeers(new Map([[currentUser.id, { id: currentUser.id, stream, isLocal: true, user: currentUser }]]));
          setCallState('active');

          const channel = supabase.channel(roomId);
          channelRef.current = channel;

          // Use a ref to access handleSignal to avoid dependency issues
          channel
            .on('broadcast', { event: 'signal' }, ({ payload }) => {
              // Use ref to access handleSignal to avoid dependency issues
              if (handleSignalRef.current) {
                handleSignalRef.current(payload, channel);
              }
            })
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
              }
            });
        } catch (err: any) {
          console.error("Failed to get media:", err);
          let errorMessage = "Could not access Camera/Microphone. ";
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errorMessage += "Please allow camera/microphone access in your browser settings.";
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            errorMessage += "No camera/microphone found. Please connect a device.";
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            errorMessage += "Device is being used by another application.";
          } else {
            errorMessage += "Please check permissions and try again.";
          }
          alert(errorMessage);
          await cleanup(false);
        }
      };
      
      autoJoin();
    }
    // Reset hasJoinedRef when incomingMode becomes null (call ended or cleared)
    if (!incomingMode) {
      hasJoinedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingMode]); // Only depend on incomingMode, not callState

  // --- CORE LOGIC: JOIN CALL (AFTER USER CLICK) ---
  const joinCall = useCallback(async () => {
    // Browser compatibility check
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
      await cleanup(false);
      return;
    }

    // This is the critical "Audio Unlock" step for cross-platform audio
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      await audio.play();
    } catch (e) {
      console.warn('Dummy audio play failed. Autoplay might not work.', e);
    }

    if (!callType) return;
    setCallState('calling');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: callType === 'video', audio: true });
      localStream.current = stream;
      
      const initialCameraOff = callType === 'audio';
      setIsCameraOff(initialCameraOff);
      stream.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      setPeers(new Map([[currentUser.id, { id: currentUser.id, stream, isLocal: true, user: currentUser }]]));
      setCallState('active');

      const channel = supabase.channel(roomId);
      channelRef.current = channel;

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          // Use ref to access handleSignal to avoid dependency issues
          if (handleSignalRef.current) {
            handleSignalRef.current(payload, channel);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
          }
        });
    } catch (err: any) {
      console.error("Failed to get media:", err);
      let errorMessage = "Could not access Camera/Microphone. ";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += "Please allow camera/microphone access in your browser settings.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage += "No camera/microphone found. Please connect a device.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage += "Device is being used by another application.";
      } else {
        errorMessage += "Please check permissions and try again.";
      }
      alert(errorMessage);
      await cleanup(false);
    }
  }, [callType, currentUser, roomId, supabase, cleanup]);

  // --- CORE LOGIC: PEER & SIGNAL HANDLING (FIXES THE "GLARE" ERROR) ---
  const createPeer = useCallback((remoteId: number, channel: any, user: User): RTCPeerConnection => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(remoteId, pc);

    pc.onicecandidate = e => {
      if (e.candidate) {
        channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'candidate', candidate: e.candidate, senderId: currentUser.id, targetId: remoteId } });
      }
    };
    
    pc.ontrack = e => {
      console.log(`Received track from ${remoteId}:`, e.track.kind, e.streams, 'Track enabled:', e.track.enabled);
      // Handle all streams - merge tracks if multiple streams exist
      const remoteStream = e.streams[0] || new MediaStream();
      
      // If we already have a peer for this remoteId, merge tracks
      setPeers(prev => {
        const existing = prev.get(remoteId);
        const wasEmpty = prev.size === 0 || (prev.size === 1 && prev.has(currentUser.id));
        
        if (existing && existing.stream) {
          // Merge tracks from new stream into existing stream
          let tracksAdded = false;
          e.streams.forEach(stream => {
            stream.getTracks().forEach(track => {
              // Check if track already exists
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
            const newPeers = new Map(prev).set(remoteId, { ...existing, stream: existing.stream });
            // Update call state to active when first remote track is received
            if (wasEmpty) {
              console.log('Updating callState to active after receiving first remote track');
              setCallState('active');
            }
            return newPeers;
          }
          return prev;
        } else {
          // Create new peer entry
          console.log(`Creating new peer entry for ${remoteId} with stream tracks:`, remoteStream.getTracks().map(t => t.kind));
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
    
    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${remoteId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`Connection ${pc.connectionState} for peer ${remoteId}`);
        // Notify user if connection fails
        if (pc.connectionState === 'failed' && !isGroup) {
          console.error('Connection failed. This may be due to network issues or firewall restrictions.');
          // Don't auto-cleanup on failed - let user decide, but log the issue
        }
      } else if (pc.connectionState === 'connected') {
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
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${remoteId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('ICE connection failed. May need TURN server or check network.');
        console.error('Connection details:', {
          connectionState: pc.connectionState,
          signalingState: pc.signalingState,
          hasLocalDescription: !!pc.localDescription,
          hasRemoteDescription: !!pc.remoteDescription
        });
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log(`ICE connection ${pc.iceConnectionState} for peer ${remoteId}`);
      }
    };
    
    localStream.current?.getTracks().forEach(track => pc.addTrack(track, localStream.current!));
    
    return pc;
  }, [currentUser.id]);
  
  const handleSignal = useCallback(async (payload: any, channel: any) => {
    const { type, senderId, targetId, sdp, candidate, user } = payload;
    if (senderId === currentUser.id) return;

    let pc = peerConnections.current.get(senderId);

    try {
      switch (type) {
        // THIS LOGIC PREVENTS THE RACE CONDITION
        case 'join':
          // A new user joined. This peer (already in the call) creates and sends an offer.
          if (!pc) pc = createPeer(senderId, channel, user);
          
          // Prevent duplicate offer creation
          if (pendingOffers.current.has(senderId)) {
            console.log('Offer already pending for this peer, skipping');
            return;
          }
          
          // Check if we already have a local description (offer already created)
          if (pc.localDescription) {
            console.log('Offer already created for this peer, skipping');
            return;
          }
          
          // Only create offer if in stable state
          if (pc.signalingState === 'stable') {
            pendingOffers.current.add(senderId);
            try {
              // Ensure we have tracks before creating offer
              if (localStream.current && localStream.current.getTracks().length > 0) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log(`Created offer for ${senderId}, tracks in SDP:`, localStream.current.getTracks().map(t => t.kind));
                channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: pc.localDescription, senderId: currentUser.id, targetId: senderId } });
              } else {
                console.warn('Cannot create offer: no local stream tracks available');
              }
              pendingOffers.current.delete(senderId);
            } catch (e: any) {
              pendingOffers.current.delete(senderId);
              console.error('Failed to create offer:', e);
              // Don't alert on "mid" errors - it's usually a race condition that resolves itself
              if (!e.message?.includes('mid') && !e.message?.includes('m-sections')) {
                alert('Failed to establish connection. Please try again.');
              }
            }
          } else {
            console.log(`Cannot create offer in signaling state: ${pc.signalingState}`);
          }
          break;
        case 'offer':
          // This peer is the new joiner. It receives an offer and sends an answer.
          if (targetId === currentUser.id) {
            if (!pc) pc = createPeer(senderId, channel, user);
            
            // Check if we already have a remote description set
            if (pc.remoteDescription) {
              console.log('Remote description already set, ignoring duplicate offer');
              return;
            }
            
            // Only process offer if in stable state (not if we already have a local offer)
            if (pc.signalingState === 'stable') {
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log(`Set remote description (offer) from ${senderId}`);
                // Ensure we have tracks before creating answer
                if (localStream.current && localStream.current.getTracks().length > 0) {
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  console.log(`Created answer for ${senderId}, tracks in SDP:`, localStream.current.getTracks().map(t => t.kind));
                  channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: pc.localDescription, senderId: currentUser.id, targetId: senderId } });
                } else {
                  console.warn('Cannot create answer: no local stream tracks available');
                }
              } catch (e: any) {
                console.error('Failed to handle offer:', e);
                // Don't alert on state errors - usually race conditions
                if (!e.message?.includes('stable') && !e.message?.includes('state') && !e.message?.includes('mid')) {
                  alert('Failed to establish connection. Please try again.');
                  await cleanup(false);
                }
              }
            } else {
              console.log(`Cannot process offer in signaling state: ${pc.signalingState}`);
            }
          }
          break;
        case 'answer':
          if (targetId === currentUser.id) {
            // Ensure peer connection exists - create if it doesn't (edge case for mobile)
            if (!pc) {
              console.warn(`Answer received but no peer connection exists for ${senderId}, creating one`);
              pc = createPeer(senderId, channel, user);
            }
            
            // Check if we already have a remote description (answer already set)
            if (pc.remoteDescription && pc.signalingState === 'stable') {
              console.log('Answer already set and connection stable, ignoring duplicate');
              return;
            }
            
            // Only set answer if we're in have-local-offer state
            if (pc.signalingState === 'have-local-offer') {
              try {
                console.log(`Setting remote description (answer) from ${senderId}, current state: ${pc.signalingState}`);
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log(`Successfully set answer from ${senderId}, new state: ${pc.signalingState}`);
                
                // Update call state to active when answer is received (call is being established)
                if (callState !== 'active') {
                  console.log('Updating callState to active after receiving answer');
                  setCallState('active');
                }
                
                // Process any queued ICE candidates now that description is set
                if (iceCandidateQueue.current.has(senderId)) {
                  const queue = iceCandidateQueue.current.get(senderId)!;
                  console.log(`Processing ${queue.length} queued ICE candidates for ${senderId}`);
                  for (const candidate of queue) {
                    try {
                      await pc.addIceCandidate(candidate);
                    } catch (e) {
                      console.warn('Failed to add queued ICE candidate:', e);
                    }
                  }
                  iceCandidateQueue.current.delete(senderId);
                }
              } catch (e: any) {
                console.error(`Failed to set remote description (answer) from ${senderId}:`, e);
                console.error('Error details:', {
                  message: e.message,
                  name: e.name,
                  signalingState: pc.signalingState,
                  hasRemoteDescription: !!pc.remoteDescription,
                  hasLocalDescription: !!pc.localDescription
                });
                
                // Don't alert on state errors - usually means answer already set or race condition
                if (!e.message?.includes('stable') && !e.message?.includes('state') && !e.message?.includes('InvalidStateError')) {
                  alert('Failed to establish connection. Please try again.');
                  await cleanup(false);
                } else {
                  // For state errors, log but don't fail - might be a race condition that resolves
                  console.warn('State error when setting answer, but continuing - might resolve itself');
                }
              }
            } else {
              console.warn(`Cannot set answer in signaling state: ${pc.signalingState} (expected: have-local-offer)`);
              console.warn('Peer connection state:', {
                signalingState: pc.signalingState,
                connectionState: pc.connectionState,
                iceConnectionState: pc.iceConnectionState,
                hasLocalDescription: !!pc.localDescription,
                hasRemoteDescription: !!pc.remoteDescription
              });
              
              // If we're in stable state but have local description, try to set answer anyway (mobile edge case)
              if (pc.signalingState === 'stable' && pc.localDescription && !pc.remoteDescription) {
                console.log('Attempting to set answer in stable state (mobile browser edge case)');
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                  console.log('Successfully set answer in stable state');
                  // Update call state to active when answer is set
                  setCallState(prev => {
                    if (prev !== 'active') {
                      console.log('Updating callState to active after receiving answer (stable state)');
                      return 'active';
                    }
                    return prev;
                  });
                } catch (e: any) {
                  console.error('Failed to set answer in stable state:', e);
                }
              }
            }
          }
          break;
        case 'candidate':
          if (targetId === currentUser.id) {
            if (!pc) {
              console.warn('Received ICE candidate but no peer connection exists');
              return;
            }
            
            // Queue candidates if remote description not ready yet
            if (!pc.remoteDescription) {
              if (!iceCandidateQueue.current.has(senderId)) {
                iceCandidateQueue.current.set(senderId, []);
              }
              iceCandidateQueue.current.get(senderId)!.push(new RTCIceCandidate(candidate));
              console.log('Queued ICE candidate, waiting for remote description');
            } else {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                // Process queued candidates if any
                if (iceCandidateQueue.current.has(senderId)) {
                  const queue = iceCandidateQueue.current.get(senderId)!;
                  for (const queuedCandidate of queue) {
                    try {
                      await pc.addIceCandidate(queuedCandidate);
                    } catch (e) {
                      console.warn('Failed to add queued ICE candidate:', e);
                    }
                  }
                  iceCandidateQueue.current.delete(senderId);
                }
              } catch (e) {
                console.error('Failed to add ICE candidate:', e);
              }
            }
          }
          break;
        case 'leave':
          if (peerConnections.current.has(senderId)) {
            peerConnections.current.get(senderId)?.close();
            peerConnections.current.delete(senderId);
          }
          setPeers(prev => {
            const newPeers = new Map(prev);
            newPeers.delete(senderId);
            return newPeers;
          });
          if (!isGroup) {
            alert("The other user has ended the call.");
            await cleanup(false);
          }
          break;
      }
    } catch (error) {
      console.error(`Signaling error for ${type}:`, error);
      // Show user-friendly error for critical signaling failures
      if (type === 'offer' || type === 'answer') {
        alert('Connection error occurred. Please try again.');
        await cleanup(false);
      }
    }
  }, [currentUser.id, isGroup, createPeer, cleanup]);

  // Update ref when handleSignal changes
  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  // --- UI CONTROLS ---
  const toggleMic = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => { track.enabled = !track.enabled; });
      setIsMicMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (callType === 'video' && localStream.current) {
      localStream.current.getVideoTracks().forEach(track => { track.enabled = !track.enabled; });
      setIsCameraOff(prev => !prev);
    }
  };

  // --- RENDER LOGIC ---
  if (callState === 'idle') {
    return (
      <div className="border-b border-gray-800 p-3 bg-gray-900">
        <div className="flex gap-2 justify-end">
          <button onClick={() => initiateCall('audio', true)} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-full text-white text-sm"><Phone size={18} /></button>
          <button onClick={() => initiateCall('video', true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-full text-white text-sm"><VideoIcon size={18} /></button>
        </div>
      </div>
    );
  }


  return (
    <div className="border-b border-gray-800 p-3 bg-gray-900">
        <div className="space-y-4 animate-in fade-in">
          <div className="flex justify-between items-center bg-gray-800 p-2 rounded-lg border border-gray-700 shadow-lg">
            <span className="text-green-400 text-sm font-bold flex items-center gap-2 px-2">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>
              {callState === 'calling' ? 'Connecting...' : 'Live'}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={toggleMic} className={`p-2 rounded-full text-white ${isMicMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}</button>
              {callType === 'video' && <button onClick={toggleCamera} className={`p-2 rounded-full text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isCameraOff ? <VideoOff size={20} /> : <VideoIcon size={20} />}</button>}
            </div>
            <button onClick={handleEndCallClick} className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-full text-white flex items-center gap-2 text-sm font-bold"><PhoneOff size={16} /> End</button>
          </div>

          <div className={`grid gap-3 ${peers.size > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {Array.from(peers.values()).map(p => <VideoPlayer key={p.id} peer={p} />)}
            {peers.size === 1 && !isGroup && callState === 'active' && <div className="flex items-center justify-center aspect-video bg-gray-800 rounded-lg border border-gray-700 text-gray-400 text-xs">Waiting for other user...</div>}
          </div>
        </div>
    </div>
  );
}

