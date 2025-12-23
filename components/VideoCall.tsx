'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { User } from '@/types'
import { Phone, PhoneOff, Video as VideoIcon, VideoOff, Mic, MicOff, Image as ImageIcon } from 'lucide-react'

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
  updateKey?: number; // Force re-render when stream changes
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
  const trackCountRef = useRef<{ video: number; audio: number }>({ video: 0, audio: 0 });

  useEffect(() => {
    if (!peer.stream) return;
    
    // Track the number of tracks to detect changes even if stream reference doesn't change
    const videoTracks = peer.stream.getVideoTracks();
    const audioTracks = peer.stream.getAudioTracks();
    const currentTrackCount = { video: videoTracks.length, audio: audioTracks.length };
    
    // Get track IDs to detect actual track changes
    const videoTrackId = videoTracks[0]?.id || '';
    const audioTrackId = audioTracks[0]?.id || '';
    
    // Check if tracks changed
    const tracksChanged = 
      trackCountRef.current.video !== currentTrackCount.video ||
      trackCountRef.current.audio !== currentTrackCount.audio;
    
    if (tracksChanged) {
      console.log(`📹 VideoPlayer: Tracks changed for peer ${peer.id}`, {
        video: `${trackCountRef.current.video} -> ${currentTrackCount.video}`,
        audio: `${trackCountRef.current.audio} -> ${currentTrackCount.audio}`
      });
      trackCountRef.current = currentTrackCount;
    }
    
    // Update video element - ALWAYS update to force refresh
    if (videoRef.current && peer.stream) {
      const videoTracks = peer.stream.getVideoTracks();
      const currentTrackId = videoTracks[0]?.id || '';
      const currentSrcObject = videoRef.current.srcObject as MediaStream | null;
      const currentTrackIdInVideo = (currentSrcObject?.getVideoTracks()[0]?.id) || '';
      
      // Track updateKey to detect when stream is reprocessed
      const previousUpdateKey = (videoRef.current as any)._lastUpdateKey || 0;
      const currentUpdateKey = peer.updateKey || 0;
      
      // Also check stream ID to detect when a new processed stream is created
      const currentStreamId = peer.stream?.id || '';
      const currentSrcObjectId = (currentSrcObject as MediaStream)?.id || '';
      
      // Always update if stream is different OR track ID is different OR updateKey changed OR stream ID changed
      const needsUpdate = currentSrcObject !== peer.stream || 
                         currentTrackIdInVideo !== currentTrackId ||
                         previousUpdateKey !== currentUpdateKey ||
                         currentStreamId !== currentSrcObjectId;
      
      if (needsUpdate) {
        console.log(`📹 VideoPlayer: Updating video for peer ${peer.id}`, {
          streamChanged: currentSrcObject !== peer.stream,
          trackChanged: currentTrackIdInVideo !== currentTrackId,
          updateKeyChanged: previousUpdateKey !== currentUpdateKey,
          streamIdChanged: currentStreamId !== currentSrcObjectId,
          oldTrackId: currentTrackIdInVideo,
          newTrackId: currentTrackId,
          oldStreamId: currentSrcObjectId,
          newStreamId: currentStreamId,
          previousUpdateKey,
          currentUpdateKey
        });
        
        // Store current updateKey on video element to track changes
        (videoRef.current as any)._lastUpdateKey = currentUpdateKey;
        
        // Force update by clearing first
        try {
          videoRef.current.pause();
          // Remove event listeners to prevent errors
          videoRef.current.onerror = null;
          videoRef.current.onabort = null;
          videoRef.current.srcObject = null;
          // Don't call load() as it can cause DOMException on subsequent calls
          // Instead, just clear srcObject and wait a bit before setting new one
        } catch (e) {
          console.warn('⚠️ Error clearing video element:', e);
        }
        
        // Then set new stream after a delay to ensure previous stream is cleared
        const setStream = async () => {
          if (videoRef.current && peer.stream) {
            try {
              // Check if the stream track is ready (especially important for canvas streams)
              const videoTrack = peer.stream.getVideoTracks()[0];
              if (videoTrack) {
                // Wait a bit if track is not live yet (canvas streams need time to start)
                const currentState = String(videoTrack.readyState);
                if (currentState !== 'live') {
                  console.log(`⏳ VideoPlayer: Waiting for video track to be live (current state: ${currentState})`);
                  let waitCount = 0;
                  while (waitCount < 20) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    const checkState = String(videoTrack.readyState);
                    if (checkState === 'live') {
                      console.log(`✅ VideoPlayer: Video track is now live`);
                      break;
                    }
                    waitCount++;
                  }
                  const finalState = String(videoTrack.readyState);
                  if (finalState !== 'live') {
                    console.warn(`⚠️ VideoPlayer: Video track not live after waiting (state: ${finalState})`);
                  }
                }
              }
              
              // Check if video element has an abort error
              if (videoRef.current.error && 
                  videoRef.current.error.code === MediaError.MEDIA_ERR_ABORTED) {
                // Video was aborted, need to reset it
                console.log('🔄 VideoPlayer: Video element was aborted, resetting...');
                videoRef.current.load();
                // Wait a bit more after load before setting new stream
                await new Promise(resolve => setTimeout(resolve, 100));
                if (videoRef.current && peer.stream) {
                  try {
                    videoRef.current.srcObject = peer.stream;
                    videoRef.current.play().catch(e => {
                      // Ignore AbortError and NotAllowedError as they're expected
                      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                        console.warn('📹 VideoPlayer: Video play failed after reset:', e);
                      }
                    });
                    console.log(`📹 VideoPlayer: Set new stream for peer ${peer.id} after reset, track ID:`, peer.stream.getVideoTracks()[0]?.id);
                  } catch (e) {
                    console.warn('📹 VideoPlayer: Error setting stream after reset:', e);
                  }
                }
              } else {
                // Set the stream
                videoRef.current.srcObject = peer.stream;
                
                // Force the video element to recognize the new stream
                // This is especially important for canvas streams which need time to start
                if (videoRef.current.readyState === 0) {
                  // If video hasn't loaded yet, wait for it
                  await new Promise((resolve) => {
                    const checkReady = () => {
                      if (videoRef.current && videoRef.current.readyState >= 2) {
                        resolve(null);
                      } else {
                        setTimeout(checkReady, 50);
                      }
                    };
                    checkReady();
                    // Timeout after 2 seconds
                    setTimeout(() => resolve(null), 2000);
                  });
                }
                
                // Wait a bit before playing to ensure stream is ready
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Try to play the video
                try {
                  await videoRef.current.play();
                  console.log(`✅ VideoPlayer: Video playing for peer ${peer.id}`);
                } catch (e: any) {
                  // Ignore AbortError and NotAllowedError as they're expected during cleanup/autoplay
                  if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                    console.warn('📹 VideoPlayer: Video play failed:', e);
                  }
                }
                
                console.log(`📹 VideoPlayer: Set new stream for peer ${peer.id}, track ID:`, peer.stream.getVideoTracks()[0]?.id, 'track readyState:', videoTrack?.readyState, 'video readyState:', videoRef.current.readyState);
                
                // Force periodic checks to ensure the video is displaying the correct stream
                // This is especially important for canvas streams which may take time to start
                const checkInterval = setInterval(() => {
                  if (!videoRef.current || !peer.stream) {
                    clearInterval(checkInterval);
                    return;
                  }
                  
                  const currentSrc = videoRef.current.srcObject as MediaStream | null;
                  const expectedStreamId = peer.stream.id;
                  const currentStreamId = (currentSrc as MediaStream)?.id || '';
                  
                  if (currentStreamId !== expectedStreamId) {
                    console.log('🔄 VideoPlayer: Periodic check - stream mismatch detected, forcing update...', {
                      expected: expectedStreamId,
                      current: currentStreamId
                    });
                    videoRef.current.srcObject = peer.stream;
                    videoRef.current.play().catch(() => {});
                  }
                }, 500);
                
                // Clear interval after 5 seconds (10 checks)
                setTimeout(() => clearInterval(checkInterval), 5000);
              }
            } catch (e) {
              console.warn('📹 VideoPlayer: Error setting stream:', e);
            }
          }
        };
        
        // Set after delay to ensure previous stream is cleared
        setStream();
      } else {
        // Even if same, force play to ensure it's active
        videoRef.current.play().catch(e => console.warn('Video play failed:', e));
      }
    }
    
    // CRITICAL: Add audio element for remote streams to hear audio
    if (!peer.isLocal && audioRef.current) {
      // Always update srcObject to ensure it reflects current stream state
      if (audioRef.current.srcObject !== peer.stream) {
        audioRef.current.srcObject = peer.stream;
        console.log(`🔊 VideoPlayer: Updated audio srcObject for remote peer ${peer.id}`);
      }
      // Ensure audio is not muted and force play
      audioRef.current.muted = false;
      audioRef.current.volume = 1.0;
      audioRef.current.play().catch(e => console.warn('Audio play failed:', e));
      console.log(`Audio element set for remote peer ${peer.id}, tracks:`, audioTracks.length);
    }
  }, [peer.stream, peer.isLocal, peer.id, peer.stream?.getVideoTracks()[0]?.id, peer.updateKey, peer.stream?.id]);

  const isVideoEnabled = peer.stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled);
  const videoTrackId = peer.stream?.getVideoTracks()[0]?.id || '';
  const streamId = peer.stream?.id || '';
  const updateKey = peer.updateKey || 0;

  return (
    <div className="relative aspect-video bg-slate-700 rounded-lg overflow-hidden border border-slate-600 shadow-inner flex items-center justify-center">
      <video
        key={`video-${peer.id}-${videoTrackId}-${streamId}-${updateKey}`}
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
          <span className="text-sm text-slate-200">{peer.isLocal ? 'You' : peer.user?.nickname}</span>
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
// Predefined background images
const BACKGROUND_OPTIONS = [
  { id: 'none', name: 'None', url: null },
  { id: 'blur', name: 'Blur', url: 'blur' },
  { id: 'office', name: 'Office', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&h=1080&fit=crop' },
  { id: 'beach', name: 'Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&h=1080&fit=crop' },
  { id: 'space', name: 'Space', url: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=1920&h=1080&fit=crop' },
  { id: 'nature', name: 'Nature', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&h=1080&fit=crop' },
];

export default function VideoCall({ currentUser, activeChat, isGroup, incomingMode, onCallEnd }: VideoCallProps) {
  const [callState, setCallState] = useState<'idle' | 'calling' | 'active'>('idle');
  const callStateRef = useRef<'idle' | 'calling' | 'active'>('idle');
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [peers, setPeers] = useState<Map<number, Peer>>(new Map());
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  // Initialize selectedBackground from localStorage synchronously to avoid race conditions
  const [selectedBackground, setSelectedBackground] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('selectedBackground');
      return saved || 'none';
    }
    return 'none';
  });
  const [userBackgrounds, setUserBackgrounds] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [streamUpdateKey, setStreamUpdateKey] = useState(0); // Force re-render when stream changes
  
  const localStream = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null); // Processed stream with background
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const selfieSegmentationRef = useRef<any | null>(null);
  const latestSegmentationResultsRef = useRef<any | null>(null); // Store latest segmentation results
  const peerConnections = useRef<Map<number, RTCPeerConnection>>(new Map());
  const channelRef = useRef<any>(null);
  const notifyChannelRef = useRef<any>(null);
  const senderNotificationChannelRef = useRef<any>(null); // Channel to listen for rejection signals
  const iceCandidateQueue = useRef<Map<number, RTCIceCandidate[]>>(new Map());
  const handleSignalRef = useRef<any>(null);
  const pendingOffers = useRef<Set<number>>(new Set()); // Track peers we're creating offers for
  const hasJoinedRef = useRef<boolean>(false); // Track if we've already joined to prevent re-joining
  const permissionDeniedRef = useRef<boolean>(false); // Track if permission was denied to prevent retry loops
  const currentUserRef = useRef<User>(currentUser); // Store currentUser in ref for cleanup
  const leaveSignalProcessedRef = useRef<Set<number>>(new Set()); // Track processed leave signals to prevent duplicates
  const supabase = createClient();
  
  // Keep currentUserRef in sync
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Reset call state function (reusable)
  const resetCallState = useCallback(async () => {
    console.log('🔄 Resetting call state to initial');
    
    // Reset all state to initial values
    setCallState('idle');
    callStateRef.current = 'idle';
    setCallType(null);
    setPeers(new Map());
    setIsMicMuted(false);
    setIsCameraOff(false);
    
    // Clear refs
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    iceCandidateQueue.current.clear();
    pendingOffers.current.clear();
    // Only reset hasJoinedRef if permission wasn't denied (to prevent retry loop)
    if (!permissionDeniedRef.current) {
      hasJoinedRef.current = false;
    }
    // Don't reset permissionDeniedRef here - let it persist until incomingMode is cleared
    
    // Stop any media streams
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach(track => track.stop());
      processedStreamRef.current = null;
    }
    
    // Stop background processing
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Cleanup channels
    if (channelRef.current) {
      try {
        await supabase.removeChannel(channelRef.current);
      } catch (e) {
        console.error('Error removing channel during reset:', e);
      }
      channelRef.current = null;
    }
    if (notifyChannelRef.current) {
      try {
        await supabase.removeChannel(notifyChannelRef.current);
      } catch (e) {
        console.error('Error removing notification channel during reset:', e);
      }
      notifyChannelRef.current = null;
    }
    if (senderNotificationChannelRef.current) {
      // Remove window event listener if it was set up
      const handler = (senderNotificationChannelRef.current as any)?.rejectionHandler;
      if (handler) {
        window.removeEventListener('call-rejected', handler as EventListener);
        (senderNotificationChannelRef.current as any).rejectionHandler = null;
      }
      // Check if it's a channel (has removeChannel method) or just a handler object
      if (typeof (senderNotificationChannelRef.current as any).removeChannel === 'function') {
        try {
          await supabase.removeChannel(senderNotificationChannelRef.current);
        } catch (e) {
          console.error('Error removing sender notification channel during reset:', e);
        }
      }
      senderNotificationChannelRef.current = null;
    }
  }, [supabase]);

  // Track previous activeChat and currentUser to detect actual changes
  const prevActiveChatIdRef = useRef<number | undefined>(activeChat?.id);
  const prevCurrentUserIdRef = useRef<number | undefined>(currentUser?.id);
  
  // Reset call state to initial when activeChat or currentUser changes
  useEffect(() => {
    const prevActiveChatId = prevActiveChatIdRef.current;
    const prevCurrentUserId = prevCurrentUserIdRef.current;
    
    // Only reset if activeChat or currentUser actually changed (not on initial mount)
    const activeChatChanged = prevActiveChatId !== undefined && activeChat?.id !== prevActiveChatId;
    const currentUserChanged = prevCurrentUserId !== undefined && currentUser?.id !== prevCurrentUserId;
    
    if ((activeChatChanged || currentUserChanged) && activeChat?.id !== undefined && currentUser?.id !== undefined) {
      console.log('🔄 Resetting call state due to activeChat or currentUser change');
      resetCallState();
    }
    
    // Update refs
    prevActiveChatIdRef.current = activeChat?.id;
    prevCurrentUserIdRef.current = currentUser?.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id, currentUser?.id, resetCallState]);

  // Track previous incomingMode to detect changes
  const prevIncomingModeRef = useRef<'audio' | 'video' | null | undefined>(incomingMode);
  
  // Reset call state when incomingMode changes from non-null to null (call rejected or ended)
  useEffect(() => {
    const prevIncomingMode = prevIncomingModeRef.current;
    prevIncomingModeRef.current = incomingMode;
    
    // Only reset if incomingMode changed FROM a non-null value TO null
    // This prevents resetting when incomingMode is null by default (not a rejected call)
    if (prevIncomingMode !== null && prevIncomingMode !== undefined && incomingMode === null) {
      // Only reset if there's an active call state
      if (callState !== 'idle' || callType !== null || peers.size > 0 || localStream.current) {
        console.log('🔄 Resetting call state because incomingMode changed from', prevIncomingMode, 'to null (call rejected/ended)');
        resetCallState();
      }
    }
  }, [incomingMode, callState, callType, peers.size, resetCallState]);

  // Track previous selectedBackground to detect changes
  const prevSelectedBackgroundRef = useRef<string>(selectedBackground);
  
  // Load selected background from localStorage on mount and when it changes
  useEffect(() => {
    const loadSelectedBackground = () => {
      const saved = localStorage.getItem('selectedBackground') || 'none';
      if (saved !== prevSelectedBackgroundRef.current) {
        prevSelectedBackgroundRef.current = saved;
        setSelectedBackground(saved);
      }
    };
    
    // Load immediately on mount
    loadSelectedBackground();
    
    // Listen for storage changes (when background is changed in Settings from another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'selectedBackground') {
        const newValue = e.newValue || 'none';
        if (newValue !== prevSelectedBackgroundRef.current) {
          prevSelectedBackgroundRef.current = newValue;
          setSelectedBackground(newValue);
          // If call is active, apply the new background immediately
          if (callType === 'video' && (callState === 'active' || callState === 'calling') && localStream.current) {
            handleBackgroundChange(newValue);
          }
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically in case of same-tab updates (Settings modal in same tab)
    const interval = setInterval(() => {
      const saved = localStorage.getItem('selectedBackground') || 'none';
      if (saved !== prevSelectedBackgroundRef.current) {
        prevSelectedBackgroundRef.current = saved;
        setSelectedBackground(saved);
        // If call is active, apply the new background immediately
        if (callType === 'video' && (callState === 'active' || callState === 'calling') && localStream.current) {
          handleBackgroundChange(saved);
        }
      }
    }, 300); // Check more frequently for better responsiveness
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [callType, callState]);
  
  // Update ref when selectedBackground changes
  useEffect(() => {
    prevSelectedBackgroundRef.current = selectedBackground;
  }, [selectedBackground]);
  
  // Load user backgrounds from localStorage on mount and when it changes
  useEffect(() => {
    const loadBackgrounds = () => {
      const saved = localStorage.getItem('userBackgrounds');
      if (saved) {
        try {
          setUserBackgrounds(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load user backgrounds:', e);
        }
      } else {
        setUserBackgrounds([]);
      }
    };
    
    loadBackgrounds();
    
    // Listen for storage changes (when backgrounds are updated in Settings)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'userBackgrounds') {
        loadBackgrounds();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically in case of same-tab updates
    const interval = setInterval(loadBackgrounds, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);
  
  // Get all available backgrounds (predefined + user uploaded)
  const getAllBackgrounds = useCallback(() => {
    return [...BACKGROUND_OPTIONS, ...userBackgrounds];
  }, [userBackgrounds]);
  
  // Get background by ID
  const getBackgroundById = useCallback((id: string) => {
    return getAllBackgrounds().find(bg => bg.id === id);
  }, [getAllBackgrounds]);
  

  const roomId = `call-${isGroup ? `group-${activeChat.id}` : `dm-${[currentUser.id, activeChat.id].sort().join('-')}`}`;

  // --- CORE LOGIC: CLEANUP ---
  const cleanup = useCallback(async (isLeaving: boolean) => {
    console.log('🧹 Starting cleanup, isLeaving:', isLeaving);
    
    if (isLeaving && channelRef.current) {
      try {
        // Check channel state before sending
        const channelState = channelRef.current.state;
        const channelName = channelRef.current.topic || 'unknown';
        console.log('📤 [SENDER] Preparing to send leave signal');
        console.log('📤 [SENDER] Channel state:', channelState);
        console.log('📤 [SENDER] Channel name/topic:', channelName);
        console.log('📤 [SENDER] RoomId:', roomId);
        console.log('📤 [SENDER] Current user ID:', currentUser.id);
        
        const leavePayload = { type: 'leave', senderId: currentUser.id };
        console.log('📤 [SENDER] Leave payload:', leavePayload);
        
        // Try to send regardless of state - sometimes it works even if not SUBSCRIBED
        try {
          console.log('📤 [SENDER] Attempting to send leave signal...');
          await channelRef.current.send({ 
            type: 'broadcast', 
            event: 'signal', 
            payload: leavePayload 
          });
          console.log('✅ [SENDER] Leave signal sent successfully');
          
          // Wait a bit to ensure the signal is delivered before removing the channel
          // This gives the receiver time to receive and process the leave signal
          await new Promise(resolve => setTimeout(resolve, 500));
          
          console.log('✅ [SENDER] Wait completed, removing channel');
        } catch (sendError) {
          console.error('❌ [SENDER] Failed to send leave signal:', sendError);
          // If channel is not subscribed, try to subscribe first
          if (channelState !== 'SUBSCRIBED') {
            console.log('⚠️ [SENDER] Channel not subscribed, attempting to subscribe...');
            try {
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 2000);
                channelRef.current!.subscribe((status: string) => {
                  console.log('📡 [SENDER] Subscription status:', status);
                  if (status === 'SUBSCRIBED') {
                    clearTimeout(timeout);
                    resolve(null);
                  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    clearTimeout(timeout);
                    reject(new Error(`Subscription failed: ${status}`));
                  }
                });
              });
              
              // Now try sending again
              console.log('📤 [SENDER] Retrying leave signal after subscription...');
              await channelRef.current.send({ 
                type: 'broadcast', 
                event: 'signal', 
                payload: leavePayload 
              });
              console.log('✅ [SENDER] Leave signal sent after subscription');
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (retryError) {
              console.error('❌ [SENDER] Failed to send leave signal after subscription retry:', retryError);
            }
          }
        }
        
        console.log('🧹 [SENDER] Removing channel');
        await supabase.removeChannel(channelRef.current);
        console.log('✅ [SENDER] Channel removed');
      } catch (e) { 
        console.error("❌ [SENDER] Error during cleanup send/remove:", e);
        // Still try to remove channel even if send failed
        try {
          await supabase.removeChannel(channelRef.current);
        } catch (removeError) {
          console.error("❌ [SENDER] Error removing channel:", removeError);
        }
      }
    } else if (isLeaving) {
      console.warn('⚠️ [SENDER] Cannot send leave signal: channelRef.current is null');
    }
    
    // Remove channel if it exists (for both sender and receiver)
    if (channelRef.current && !isLeaving) {
      // Receiver cleanup - remove channel without sending leave signal
      try {
        console.log('🧹 [RECEIVER] Removing channel during cleanup');
        await supabase.removeChannel(channelRef.current);
        console.log('✅ [RECEIVER] Channel removed');
        channelRef.current = null; // Clear the ref after removal
      } catch (e) {
        console.error('❌ [RECEIVER] Error removing channel:', e);
        channelRef.current = null; // Clear the ref even if removal failed
      }
    }
    
    // Cleanup notification channel
    if (notifyChannelRef.current) {
      try {
        // Clear any rejection timeout
        if ((notifyChannelRef.current as any).rejectionTimeout) {
          clearTimeout((notifyChannelRef.current as any).rejectionTimeout);
          (notifyChannelRef.current as any).rejectionTimeout = null;
        }
        await supabase.removeChannel(notifyChannelRef.current);
      } catch (e) { console.error("Error removing notification channel:", e) }
      notifyChannelRef.current = null;
    }
    
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
    
    channelRef.current = null;
    // Stop background processing
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Cleanup video element and canvas
    if (videoElementRef.current) {
      try {
        // Stop processing if it's still active
        const stopProcessing = (videoElementRef.current as any)?._stopProcessing;
        if (stopProcessing && typeof stopProcessing === 'function') {
          stopProcessing();
        }
        // Pause and clear video element before nulling
        videoElementRef.current.pause();
        // Remove all event listeners to prevent errors
        videoElementRef.current.onloadedmetadata = null;
        videoElementRef.current.onerror = null;
        videoElementRef.current.srcObject = null;
        videoElementRef.current.load(); // Reset video element
        // Abort any ongoing media loading
        if (videoElementRef.current.src) {
          videoElementRef.current.src = '';
        }
      } catch (e) {
        // Ignore errors during cleanup
        console.warn('⚠️ Error during video element cleanup:', e);
      }
      videoElementRef.current = null;
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      canvasRef.current = null;
    }
    
    // Cleanup background image to prevent DOMException on subsequent calls
    if (backgroundImageRef.current) {
      try {
        // Remove event listeners to prevent errors
        backgroundImageRef.current.onload = null;
        backgroundImageRef.current.onerror = null;
        // Abort any ongoing image load by setting src to empty string
        if (backgroundImageRef.current.src) {
          backgroundImageRef.current.src = '';
        }
      } catch (e) {
        console.warn('⚠️ Error during background image cleanup:', e);
      }
      backgroundImageRef.current = null;
    }
    
    // Stop processed stream tracks
    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      processedStreamRef.current = null;
    }
    
    // Reset MediaPipe segmentation results to prevent stale data on next call
    latestSegmentationResultsRef.current = null;
    
    // Note: We don't reset selfieSegmentationRef.current because MediaPipe can be reused
    // across calls for better performance. It will be reinitialized if needed.
    
    // Stop local stream tracks
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      localStream.current = null;
    }
    peerConnections.current.forEach(pc => {
      try {
        pc.close();
      } catch (e) {
        console.error('Error closing peer connection:', e);
      }
    });
    peerConnections.current.clear();
    iceCandidateQueue.current.clear();
    pendingOffers.current.clear();
    leaveSignalProcessedRef.current.clear(); // Clear processed leave signals
    // Only reset hasJoinedRef if permission wasn't denied (to prevent retry loop)
    if (!permissionDeniedRef.current) {
      hasJoinedRef.current = false; // Reset join flag
    }
    // Don't reset permissionDeniedRef here - let it persist until incomingMode is cleared
    
    // DON'T clear handleSignalRef here - it will be set by useEffect when handleSignal changes
    // Clearing it can cause issues if a new call starts before the useEffect runs
    // The useEffect at line 1707 will keep it updated, and initiateCall will set it if needed
    // handleSignalRef.current = null; // REMOVED - let useEffect manage this
    
    // Reset state
    setPeers(new Map());
    setCallState('idle');
    callStateRef.current = 'idle';
    setCallType(null);
    setIsMicMuted(false);
    setIsCameraOff(false);
    
    console.log('✅ All cleanup completed, calling onCallEnd');
    onCallEnd(); // Notify parent to reset state
  }, [currentUser.id, supabase, onCallEnd]);

  // --- BACKGROUND PROCESSING ---
  const processVideoWithBackground = useCallback(async (stream: MediaStream, backgroundId: string): Promise<MediaStream> => {
    // Log the backgroundId parameter to verify it's correct
    console.log('🎨 [PROCESS VIDEO] Called with backgroundId:', backgroundId, 'stream ID:', stream.id);
    
    // Always get the latest backgrounds from localStorage to ensure we have user-uploaded backgrounds
    let latestUserBackgrounds: Array<{ id: string; name: string; url: string }> = [];
    try {
      const saved = localStorage.getItem('userBackgrounds');
      if (saved) {
        latestUserBackgrounds = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load user backgrounds from localStorage:', e);
    }
    
    console.log('🎨 [PROCESS VIDEO] Processing video with background:', backgroundId, 'Available backgrounds:', latestUserBackgrounds.length);
    console.log('📊 [PROCESS VIDEO] Input stream has', stream.getVideoTracks().length, 'video tracks');
    
    if (backgroundId === 'none') {
      console.log('⏭️ [PROCESS VIDEO] No background selected, returning original stream');
      return stream; // Return original stream if no background
    }
    
    console.log('✅ [PROCESS VIDEO] Background ID is valid, proceeding with processing...');

    // Stop any existing processing
    if (animationFrameRef.current) {
      console.log('🛑 [PROCESS VIDEO] Stopping existing animation frame before starting new processing');
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Cleanup old video element and background image before starting new processing
    if (videoElementRef.current) {
      console.log('🛑 [PROCESS VIDEO] Cleaning up old video element');
      try {
        const stopProcessing = (videoElementRef.current as any)?._stopProcessing;
        if (stopProcessing && typeof stopProcessing === 'function') {
          stopProcessing();
        }
        videoElementRef.current.pause();
        videoElementRef.current.onloadedmetadata = null;
        videoElementRef.current.onerror = null;
        videoElementRef.current.srcObject = null;
        if (videoElementRef.current.src) {
          videoElementRef.current.src = '';
        }
      } catch (e) {
        console.warn('⚠️ [PROCESS VIDEO] Error cleaning up old video element:', e);
      }
      videoElementRef.current = null;
    }
    
    // Cleanup old background image to prevent DOMException
    if (backgroundImageRef.current) {
      console.log('🛑 [PROCESS VIDEO] Cleaning up old background image');
      try {
        backgroundImageRef.current.onload = null;
        backgroundImageRef.current.onerror = null;
        if (backgroundImageRef.current.src) {
          backgroundImageRef.current.src = ''; // Abort any ongoing load
        }
      } catch (e) {
        console.warn('⚠️ [PROCESS VIDEO] Error cleaning up old background image:', e);
      }
      backgroundImageRef.current = null;
    }
    
    // Cleanup old canvas
    if (canvasRef.current) {
      console.log('🛑 [PROCESS VIDEO] Cleaning up old canvas');
      try {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      } catch (e) {
        console.warn('⚠️ [PROCESS VIDEO] Error cleaning up old canvas:', e);
      }
      canvasRef.current = null;
    }

    // Initialize MediaPipe Selfie Segmentation if not already initialized
    // Wait for initialization to complete before proceeding
    if (!selfieSegmentationRef.current) {
      console.log('🤖 Initializing MediaPipe Selfie Segmentation...');
      try {
        const mediapipeModule = await import('@mediapipe/selfie_segmentation');
        console.log('📦 MediaPipe module loaded, available exports:', Object.keys(mediapipeModule));
        
        // Try different possible export patterns
        const SelfieSegmentation = 
          (mediapipeModule as any).SelfieSegmentation || 
          (mediapipeModule as any).default?.SelfieSegmentation || 
          (mediapipeModule as any).default;
        
        if (SelfieSegmentation && typeof SelfieSegmentation === 'function') {
          selfieSegmentationRef.current = new SelfieSegmentation({
            locateFile: (file: string) => {
              return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
            }
          });
          
          selfieSegmentationRef.current.setOptions({
            modelSelection: 1, // 0 for general, 1 for landscape (better for video calls)
          });
          
          // Initialize MediaPipe
          await selfieSegmentationRef.current.initialize();
          
          // Set up the results callback ONCE when MediaPipe is initialized
          // This callback will persist across multiple calls
          selfieSegmentationRef.current.onResults((results: any) => {
            latestSegmentationResultsRef.current = results;
            // Log occasionally to avoid spam (log ~10% of results)
            if (Math.random() < 0.1) {
              console.log('📊 [MediaPipe] Received segmentation results, mask available:', !!results?.segmentationMask, 'mask width:', results?.segmentationMask?.width, 'mask height:', results?.segmentationMask?.height);
            }
          });
          
          console.log('✅ MediaPipe Selfie Segmentation initialized and ready with callback set up');
        } else {
          console.error('❌ SelfieSegmentation class not found in module');
          console.log('📦 Module structure:', mediapipeModule);
        }
      } catch (error) {
        console.error('❌ Failed to load MediaPipe module:', error);
        // Continue without segmentation - will draw video on top of background
      }
    } else {
      // MediaPipe already initialized - ensure callback is set up
      // Always re-register the callback to ensure it's active for this processing session
      // MediaPipe's onResults can be called multiple times and will update the callback
      console.log('🔄 Ensuring MediaPipe results callback is set up for new call');
      selfieSegmentationRef.current.onResults((results: any) => {
        latestSegmentationResultsRef.current = results;
        // Log occasionally to avoid spam (log ~10% of results)
        if (Math.random() < 0.1) {
          console.log('📊 [MediaPipe] Received segmentation results, mask available:', !!results?.segmentationMask, 'mask width:', results?.segmentationMask?.width, 'mask height:', results?.segmentationMask?.height);
        }
      });
    }
    
    // Reset results for new processing session
    // This ensures we don't use stale segmentation results from previous calls
    latestSegmentationResultsRef.current = null;
    console.log('🔄 Reset segmentation results for new processing session');

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute to prevent feedback
    
    // Add error handler to catch abort errors gracefully
    video.onerror = (e) => {
      const error = video.error;
      if (error && error.code === MediaError.MEDIA_ERR_ABORTED) {
        console.log('ℹ️ [PROCESS VIDEO] Video load was aborted (expected during cleanup)');
      } else {
        console.warn('⚠️ [PROCESS VIDEO] Video error:', error);
      }
    };
    
    video.onabort = () => {
      console.log('ℹ️ [PROCESS VIDEO] Video load was aborted (expected during cleanup)');
    };
    
    // Wait for video to be ready and playing
    await new Promise((resolve) => {
      const onLoadedMetadata = async () => {
        try {
          await video.play();
          // Wait a bit more for video dimensions to be available and video to start playing
          setTimeout(() => {
            console.log('✅ [PROCESS VIDEO] Video is playing, readyState:', video.readyState, 'paused:', video.paused, 'dimensions:', video.videoWidth, 'x', video.videoHeight);
            resolve(null);
          }, 200);
        } catch (error: any) {
          // Ignore AbortError as it's expected during cleanup
          if (error.name !== 'AbortError') {
            console.warn('⚠️ [PROCESS VIDEO] Video play() failed, continuing anyway:', error);
          }
          resolve(null);
        }
      };
      
      if (video.readyState >= 1) {
        // Metadata already loaded
        onLoadedMetadata();
      } else {
        video.onloadedmetadata = onLoadedMetadata;
      }
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.error('Failed to get canvas context');
      return stream;
    }

    // Get actual video dimensions
    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    console.log('Processing video with background:', backgroundId, 'Dimensions:', videoWidth, 'x', videoHeight);

    // Get background from all available backgrounds (predefined + user uploaded)
    // Use latestUserBackgrounds from localStorage to ensure we have the most recent uploads
    const allBackgrounds = [...BACKGROUND_OPTIONS, ...latestUserBackgrounds];
    const backgroundOption = allBackgrounds.find(bg => bg.id === backgroundId);
    
    console.log('🔍 Background lookup:', {
      backgroundId,
      totalBackgrounds: allBackgrounds.length,
      predefinedCount: BACKGROUND_OPTIONS.length,
      userUploadedCount: latestUserBackgrounds.length,
      found: !!backgroundOption,
      optionDetails: backgroundOption ? { id: backgroundOption.id, name: backgroundOption.name, hasUrl: !!backgroundOption.url, url: backgroundOption.url } : null
    });
    
    if (!backgroundOption) {
      console.error('❌ Background option not found for ID:', backgroundId);
      console.log('Available background IDs:', allBackgrounds.map(bg => bg.id));
      return stream; // Return original stream if background not found
    }
    
    // Load background image if needed
    let bgImage: HTMLImageElement | null = null;
    if (backgroundOption.url && backgroundOption.url !== 'blur') {
      console.log('📷 [PROCESS VIDEO] Loading background image from URL:', backgroundOption.url);
      bgImage = new Image();
      bgImage.crossOrigin = 'anonymous';
      
      // Store in ref for potential reuse
      backgroundImageRef.current = bgImage;
      
      const imageLoaded = await new Promise<boolean>((resolve) => {
        let isResolved = false; // Prevent multiple resolutions
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            console.warn('⏱️ [PROCESS VIDEO] Background image loading timeout after 5 seconds');
            // Clean up event listeners
            bgImage!.onload = null;
            bgImage!.onerror = null;
            resolve(false); // Image failed to load in time
          }
        }, 5000); // 5 second timeout
        
        bgImage!.onload = () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            if (bgImage!.naturalWidth > 0 && bgImage!.naturalHeight > 0) {
              console.log('✅ [PROCESS VIDEO] Background image loaded successfully, dimensions:', bgImage!.naturalWidth, 'x', bgImage!.naturalHeight);
              console.log('✅ [PROCESS VIDEO] Background image complete:', bgImage!.complete, 'naturalWidth:', bgImage!.naturalWidth, 'naturalHeight:', bgImage!.naturalHeight);
              resolve(true);
            } else {
              console.warn('⚠️ [PROCESS VIDEO] Background image loaded but has invalid dimensions');
              resolve(false);
            }
          }
        };
        bgImage!.onerror = (error) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            // Check if it's an abort error (which is expected during cleanup)
            const errorEvent = error as ErrorEvent;
            if (errorEvent && errorEvent.type === 'error') {
              console.error('❌ [PROCESS VIDEO] Failed to load background image:', errorEvent, 'URL:', backgroundOption.url);
            } else {
              console.error('❌ [PROCESS VIDEO] Failed to load background image:', error, 'URL:', backgroundOption.url);
            }
            // Clean up event listeners
            bgImage!.onload = null;
            bgImage!.onerror = null;
            resolve(false); // Image failed to load
          }
        };
        
        // Set src after event listeners are attached
        try {
          bgImage!.src = backgroundOption.url;
        } catch (e) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            console.error('❌ [PROCESS VIDEO] Error setting image src:', e);
            bgImage!.onload = null;
            bgImage!.onerror = null;
            resolve(false);
          }
        }
      });
      
      if (!imageLoaded) {
        console.warn('⚠️ [PROCESS VIDEO] Background image failed to load, will use fallback');
        bgImage = null;
        backgroundImageRef.current = null;
      }
    } else if (backgroundId === 'blur') {
      console.log('🌫️ [PROCESS VIDEO] Using blur effect for background');
      backgroundImageRef.current = null;
    } else {
      console.log('⚠️ [PROCESS VIDEO] No background URL or blur effect for backgroundId:', backgroundId);
      backgroundImageRef.current = null;
    }

    let isProcessing = false;
    const segmentationReady = !!selfieSegmentationRef.current;
    
    if (segmentationReady) {
      console.log('✅ MediaPipe is ready for segmentation');
    } else {
      console.warn('⚠️ MediaPipe not initialized yet, will use fallback (video on top)');
    }

    // Flag to track if processing is still active (used to stop animation loop)
    let isProcessingActive = true;
    let firstFrameDrawn = false; // Track when first frame is drawn
    let maskFormatDetected = false; // Track if we've detected the mask format
    let useDestinationOut = false; // Whether to use destination-out (for inverted masks)
    let framesWithMask = 0; // Count frames where we have a mask (for delayed detection)

    const drawFrame = () => {
      // Stop animation loop if processing is no longer active or video is disposed
      if (!isProcessingActive || !video || video.readyState === video.HAVE_NOTHING) {
        console.log('🛑 [DRAW FRAME] Stopping animation loop - isProcessingActive:', isProcessingActive, 'video:', !!video, 'readyState:', video?.readyState);
        animationFrameRef.current = null;
        return;
      }
      
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationFrameRef.current = requestAnimationFrame(drawFrame);
        return;
      }
      
      // Clear canvas at the start of each frame to prevent artifacts from previous frames
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Reset compositing mode and alpha to defaults
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      
      // Log that we're drawing frames (but not every frame to avoid spam)
      if (Math.random() < 0.01) { // Log ~1% of frames
        console.log('🎨 [DRAW FRAME] Drawing frame, video readyState:', video.readyState, 'bgImage:', bgImage ? 'loaded' : 'none', 'MediaPipe:', !!selfieSegmentationRef.current);
      }
      
      // Mark that we've drawn at least one frame
      if (!firstFrameDrawn) {
        firstFrameDrawn = true;
      }

      // For blur effect
      if (backgroundId === 'blur') {
        // Draw blurred background (larger to create blur effect at edges)
        ctx.save();
        ctx.filter = 'blur(20px)';
        ctx.drawImage(video, -100, -100, canvas.width + 200, canvas.height + 200);
        ctx.restore();
        // Draw original video on top (centered, slightly smaller to show blur effect)
        const scale = 0.9;
        const x = (canvas.width - canvas.width * scale) / 2;
        const y = (canvas.height - canvas.height * scale) / 2;
        ctx.drawImage(video, x, y, canvas.width * scale, canvas.height * scale);
      } else if (bgImage && bgImage.complete && bgImage.naturalWidth > 0 && bgImage.naturalHeight > 0) {
        // Draw background image first (this will be behind the person)
        // Ensure we're using source-over to draw the background normally
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        
        // Fill with black first
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw background image (scale to fit canvas while maintaining aspect ratio)
        const bgAspect = bgImage.naturalWidth / bgImage.naturalHeight;
        const canvasAspect = canvas.width / canvas.height;
        
        let bgWidth, bgHeight, bgX, bgY;
        if (bgAspect > canvasAspect) {
          // Background is wider - fit to height
          bgHeight = canvas.height;
          bgWidth = bgHeight * bgAspect;
          bgX = (canvas.width - bgWidth) / 2;
          bgY = 0;
        } else {
          // Background is taller - fit to width
          bgWidth = canvas.width;
          bgHeight = bgWidth / bgAspect;
          bgX = 0;
          bgY = (canvas.height - bgHeight) / 2;
        }
        
        ctx.drawImage(bgImage, bgX, bgY, bgWidth, bgHeight);
        
        // Use MediaPipe segmentation if available and ready
        if (selfieSegmentationRef.current) {
          // Check if video element is still valid before sending to MediaPipe
          if (video.readyState >= video.HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0) {
            try {
              // Send frame to MediaPipe (results will come via onResults callback)
              // Don't await - it's fire-and-forget, results come via callback
              selfieSegmentationRef.current.send({ image: video }).catch((error: any) => {
                // Only log if it's not the "object no longer usable" error (which can happen during cleanup)
                if (error.name !== 'InvalidStateError' && !error.message?.includes('no longer, usable')) {
                  console.error('❌ [DRAW FRAME] MediaPipe send error:', error);
                }
              });
              // Log occasionally to verify MediaPipe is being called
              if (Math.random() < 0.01) {
                console.log('📤 [DRAW FRAME] Sent frame to MediaPipe, video dimensions:', video.videoWidth, 'x', video.videoHeight);
              }
            } catch (error: any) {
              // Silently handle errors during cleanup or when video is disposed
              if (error.name !== 'InvalidStateError' && !error.message?.includes('no longer, usable')) {
                console.error('❌ [DRAW FRAME] MediaPipe send exception:', error);
              }
            }
          } else {
            // Log occasionally if video isn't ready
            if (Math.random() < 0.01) {
              console.warn('⚠️ [DRAW FRAME] Video not ready for MediaPipe, readyState:', video.readyState, 'dimensions:', video.videoWidth, 'x', video.videoHeight);
            }
          }
          
          // Process the latest results from callback (stored in ref)
          const results = latestSegmentationResultsRef.current;
          if (results && results.segmentationMask) {
            // Increment counter when we have a mask (for delayed detection)
            framesWithMask++;
            
            // Log when we successfully use segmentation results (but not every frame to avoid spam)
            if (Math.random() < 0.01) { // Log ~1% of frames
              console.log('✅ [DRAW FRAME] Using MediaPipe segmentation mask, framesWithMask:', framesWithMask);
            }
            // Get segmentation mask (this is a canvas element)
            const mask = results.segmentationMask;
            
            // Create a temporary canvas to draw the person
            const personCanvas = document.createElement('canvas');
            personCanvas.width = canvas.width;
            personCanvas.height = canvas.height;
            const personCtx = personCanvas.getContext('2d');
            
            if (personCtx) {
              // MediaPipe segmentation mask: typically white = person, black = background
              // But some versions may be inverted. We'll use destination-in which should work
              // for standard masks. If background appears on top, the mask might be inverted.
              
              // Clear canvas first
              personCtx.clearRect(0, 0, personCanvas.width, personCanvas.height);
              
              // Draw the full video first
              personCtx.globalCompositeOperation = 'source-over';
              personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
              
              // Apply mask to extract person from video
              // MediaPipe mask format: white = person (foreground), black = background (standard)
              // However, if background appears on top, the mask might be inverted
              // Detect mask format once per processing session, then reuse
              
              // Detect mask format only once (wait for at least 3 frames with mask to ensure it's stable)
              // This prevents false detection on the first frame when mask might not be ready
              // Especially important for subsequent calls where mask might initialize differently
              if (!maskFormatDetected && firstFrameDrawn && framesWithMask >= 3) {
                // Try destination-in first (standard MediaPipe: white = person)
                personCtx.globalCompositeOperation = 'destination-in';
                personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
                
                // Check if we got any content (sample multiple regions for better detection)
                const regions = [
                  { x: Math.floor(personCanvas.width * 0.4), y: Math.floor(personCanvas.height * 0.3), w: Math.min(80, personCanvas.width / 5), h: Math.min(80, personCanvas.height / 5) }, // Upper center
                  { x: Math.floor(personCanvas.width * 0.4), y: Math.floor(personCanvas.height * 0.5), w: Math.min(80, personCanvas.width / 5), h: Math.min(80, personCanvas.height / 5) }, // Center
                  { x: Math.floor(personCanvas.width * 0.4), y: Math.floor(personCanvas.height * 0.7), w: Math.min(80, personCanvas.width / 5), h: Math.min(80, personCanvas.height / 5) }, // Lower center
                ];
                
                let totalContentPixels = 0;
                let totalPixels = 0;
                
                for (const region of regions) {
                  try {
                    const imageData = personCtx.getImageData(region.x, region.y, region.w, region.h);
                    // Check alpha channel (index 3 in RGBA)
                    for (let i = 3; i < imageData.data.length; i += 4) {
                      totalPixels++;
                      if (imageData.data[i] > 30) { // Has some opacity
                        totalContentPixels++;
                      }
                    }
                  } catch (e) {
                    // Skip region if we can't sample it
                  }
                }
                
                // If less than 5% of pixels have content, mask is likely inverted
                const contentRatio = totalPixels > 0 ? totalContentPixels / totalPixels : 0;
                
                if (contentRatio < 0.05) {
                  // Mask is likely inverted - use destination-out
                  useDestinationOut = true;
                  console.log('🔄 [DRAW FRAME] Detected inverted mask format (content ratio:', contentRatio.toFixed(3), '), using destination-out');
                } else {
                  console.log('✅ [DRAW FRAME] Using standard mask format (content ratio:', contentRatio.toFixed(3), '), using destination-in');
                }
                maskFormatDetected = true;
                
                // Redraw with correct format
                personCtx.clearRect(0, 0, personCanvas.width, personCanvas.height);
                personCtx.globalCompositeOperation = 'source-over';
                personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
              }
              
              // Apply mask with detected format (only if detection completed)
              if (maskFormatDetected) {
                if (useDestinationOut) {
                  // Inverted mask: white = background, so remove video where mask is opaque
                  personCtx.globalCompositeOperation = 'destination-out';
                } else {
                  // Standard mask: white = person, so keep video where mask is opaque
                  personCtx.globalCompositeOperation = 'destination-in';
                }
                personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
                
                // Verify we got content - if not, try the alternative method
                // This is a safety check in case detection was wrong
                const verifyImageData = personCtx.getImageData(0, 0, personCanvas.width, personCanvas.height);
                let hasContent = false;
                // Quick check: sample every 100th pixel
                for (let i = 3; i < verifyImageData.data.length && !hasContent; i += 400) {
                  if (verifyImageData.data[i] > 50) {
                    hasContent = true;
                  }
                }
                
                // If no content and we used destination-in, try destination-out instead
                if (!hasContent && !useDestinationOut) {
                  console.warn('⚠️ [DRAW FRAME] No content detected with destination-in, trying destination-out');
                  personCtx.clearRect(0, 0, personCanvas.width, personCanvas.height);
                  personCtx.globalCompositeOperation = 'source-over';
                  personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
                  personCtx.globalCompositeOperation = 'destination-out';
                  personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
                  useDestinationOut = true; // Update flag for future frames
                }
              } else {
                // Detection not complete yet - use standard format as fallback
                personCtx.globalCompositeOperation = 'destination-in';
                personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
              }
              
              // Now composite the person on top of background
              // Background is already drawn on main canvas, so person goes on top
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = 1.0;
              ctx.drawImage(personCanvas, 0, 0);
            } else {
              console.error('❌ Failed to create person canvas context');
              // Fallback if can't create context
              ctx.globalCompositeOperation = 'source-over';
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
          } else {
            // Results not ready yet - draw video with transparency/opacity so background shows through
            // This provides visual feedback while waiting for MediaPipe
            // Log occasionally to debug why segmentation isn't working
            if (Math.random() < 0.01) { // Log ~1% of frames
              console.log('⏳ [DRAW FRAME] Waiting for MediaPipe results, results:', !!results, 'hasMask:', results?.segmentationMask ? 'yes' : 'no', 'drawing video with fallback');
            }
            // Draw video with reduced opacity so background is partially visible
            ctx.save();
            ctx.globalAlpha = 0.7; // 70% opacity so background shows through
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        } else {
          // No segmentation available - draw video on top of background (fallback)
          // This ensures the video is always visible even if MediaPipe isn't working
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        
        animationFrameRef.current = requestAnimationFrame(drawFrame);
      } else {
        // Fallback: just draw video
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        animationFrameRef.current = requestAnimationFrame(drawFrame);
      }
    };

    // Start drawing frames
    console.log('🎬 [PROCESS VIDEO] Starting animation frame loop');
    drawFrame();
    canvasRef.current = canvas;
    videoElementRef.current = video;
    
    // Verify the drawing loop is actually running after a short delay
    setTimeout(() => {
      if (animationFrameRef.current) {
        console.log('✅ [PROCESS VIDEO] Animation frame loop is running');
      } else {
        console.error('❌ [PROCESS VIDEO] Animation frame loop stopped unexpectedly!');
      }
    }, 500);

    // Wait for video to be playing and ensure canvas has drawn at least one frame
    // This is critical for the canvas stream to work properly
    let waitCount = 0;
    const maxWait = 50; // Maximum 2.5 seconds (50 * 50ms)
    while ((!firstFrameDrawn || video.readyState < video.HAVE_CURRENT_DATA) && waitCount < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 50));
      waitCount++;
    }
    
    // Additional wait to ensure canvas stream is stable
    await new Promise(resolve => setTimeout(resolve, 300));
    
    console.log('✅ Canvas ready for stream capture, video readyState:', video.readyState, 'firstFrameDrawn:', firstFrameDrawn, 'waited:', waitCount * 50, 'ms');
    
    // Store cleanup function to stop processing when needed
    const stopProcessing = () => {
      isProcessingActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
    
    // Store stop function in a way that cleanup can access it
    (videoElementRef.current as any)._stopProcessing = stopProcessing;

    // Create new stream from canvas
    const processedStream = canvas.captureStream(30); // 30 FPS
    
    // IMPORTANT: Don't clone audio tracks - use the original audio tracks directly
    // Cloning can cause issues with peer connections
    stream.getAudioTracks().forEach(track => {
      processedStream.addTrack(track);
    });

    // Ensure the canvas video track is enabled
    const canvasVideoTrack = processedStream.getVideoTracks()[0];
    if (canvasVideoTrack) {
      canvasVideoTrack.enabled = true;
      console.log('🎥 [PROCESS VIDEO] Canvas video track:', { id: canvasVideoTrack.id, enabled: canvasVideoTrack.enabled, readyState: canvasVideoTrack.readyState, settings: canvasVideoTrack.getSettings() });
      
      // Wait for the canvas stream to actually start producing frames
      // This is critical - the stream needs to be actively capturing before it can be used
      console.log('⏳ [PROCESS VIDEO] Waiting for canvas stream to start producing frames...');
      let frameCheckCount = 0;
      const maxFrameChecks = 40; // Wait up to 2 seconds (40 * 50ms) for canvas to be ready
      while (frameCheckCount < maxFrameChecks) {
        const trackState = String(canvasVideoTrack.readyState);
        if (trackState === 'live') {
          console.log('✅ [PROCESS VIDEO] Canvas stream is live and producing frames');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        frameCheckCount++;
      }
      
      const finalState = String(canvasVideoTrack.readyState);
      if (finalState !== 'live') {
        console.warn('⚠️ [PROCESS VIDEO] Canvas stream not live after waiting (readyState:', finalState, '), but continuing');
      }
      
      // Additional wait to ensure frames are actually being captured and stream is stable
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('✅ [PROCESS VIDEO] Canvas stream should be ready now, final readyState:', String(canvasVideoTrack.readyState));
    }

    console.log('✅ [PROCESS VIDEO] Processed stream created with', processedStream.getVideoTracks().length, 'video tracks and', processedStream.getAudioTracks().length, 'audio tracks');
    console.log('📊 [PROCESS VIDEO] Processed stream video track details:', processedStream.getVideoTracks().map(t => ({ id: t.id, kind: t.kind, enabled: t.enabled, readyState: t.readyState })));
    console.log('📊 [PROCESS VIDEO] Processed stream ID:', processedStream.id);
    console.log('📊 [PROCESS VIDEO] Original stream ID:', stream.id);
    console.log('📊 [PROCESS VIDEO] Streams are different objects:', processedStream !== stream);
    return processedStream;
  }, [userBackgrounds]);

  // --- CORE LOGIC: END CALL & UNMOUNT CLEANUP ---
  const handleEndCallClick = async () => {
    console.log('🛑 End call button clicked');
    await cleanup(true);
    console.log('✅ Cleanup completed after end call');
  };
  
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
  // This version accepts an optional stream (for mobile compatibility)
  const initiateCallWithStream = useCallback(async (type: 'audio' | 'video', notify: boolean, providedStream?: MediaStream) => {
    // Check if already in a call
    if (callState !== 'idle' && localStream.current) {
      console.warn('Already in a call. End current call first.');
      return;
    }
    
    // Reset permission denied flag when user manually initiates a call
    // This allows them to try again after a previous denial
    if (permissionDeniedRef.current) {
      console.log('🔄 [INITIATE CALL] Resetting permission denied flag for manual retry');
      permissionDeniedRef.current = false;
    }
    
    // CRITICAL: Ensure handleSignalRef is set BEFORE starting the call
    // This prevents issues where signals arrive before the ref is set
    if (!handleSignalRef.current) {
      console.log('🔄 [INITIATE CALL] handleSignalRef is null, setting it now');
      handleSignalRef.current = handleSignal;
    } else {
      console.log('✅ [INITIATE CALL] handleSignalRef is already set');
    }
    
    setCallType(type);
    setCallState('calling'); // Start calling immediately, no prompting
    callStateRef.current = 'calling';
    
    // Set up rejection listener IMMEDIATELY, before sending notification
    // This ensures the listener is ready when the receiver rejects
    if (notify && !isGroup) {
      // Instead of creating a separate channel instance (which conflicts with global listener),
      // we'll listen to a custom window event that the global listener dispatches
      // The global listener in app/page.tsx already listens on notifications-${currentUser.id}
      const handleRejectionEvent = (event: Event) => {
        const customEvent = event as CustomEvent;
        const payload = customEvent.detail;
        console.log('📨 [WINDOW EVENT] Received call-rejected signal:', payload);
        console.log('📨 [WINDOW EVENT] Current callState:', callStateRef.current, 'activeChat.id:', activeChat?.id, 'payload.rejectedBy:', payload.rejectedBy);
        // Only process if this rejection is for the current call
        if (callStateRef.current === 'calling' && payload.rejectedBy === activeChat?.id) {
          console.log('❌ [WINDOW EVENT] Call rejected by receiver:', payload);
          // Clear rejection timeout since we got explicit rejection
          if ((notifyChannelRef.current as any)?.rejectionTimeout) {
            clearTimeout((notifyChannelRef.current as any).rejectionTimeout);
            (notifyChannelRef.current as any).rejectionTimeout = null;
          }
          alert(`The call was rejected${payload.rejectedByUsername ? ` by ${payload.rejectedByUsername}` : ''}.`);
          cleanup(false);
        } else {
          console.log('⚠️ [WINDOW EVENT] Rejection signal ignored - conditions not met:', {
            callState: callStateRef.current,
            expected: 'calling',
            rejectedBy: payload.rejectedBy,
            activeChatId: activeChat?.id,
            match: payload.rejectedBy === activeChat?.id
          });
        }
      };
      
      // Cleanup any existing window event listener first
      if (senderNotificationChannelRef.current) {
        const existingHandler = (senderNotificationChannelRef.current as any)?.rejectionHandler;
        if (existingHandler) {
          window.removeEventListener('call-rejected', existingHandler as EventListener);
        }
      }
      
      // Add window event listener
      window.addEventListener('call-rejected', handleRejectionEvent);
      
      // Store the handler so we can remove it later (use a dummy object since we're not using a channel)
      senderNotificationChannelRef.current = { rejectionHandler: handleRejectionEvent } as any;
      
      console.log('✅ [SENDER] Rejection listener is now ready (via window event from global listener)');
    }
    
    // Send notification to receiver
    if (notify && !isGroup) {
      // Cleanup any existing notification channel
      if (notifyChannelRef.current) {
        supabase.removeChannel(notifyChannelRef.current);
      }
      
      notifyChannelRef.current = supabase.channel(`notifications-${activeChat.id}`);
      notifyChannelRef.current.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          notifyChannelRef.current.send({ 
            type: 'broadcast', 
            event: 'incoming-call', 
            payload: { 
              caller: currentUser, 
              roomId, 
              callType: type
            } 
          });
          console.log('✅ [SENDER] Incoming call notification sent to receiver');
        }
      });
      
      // Set a timeout to detect if receiver doesn't respond (timeout only, not rejection)
      const rejectionTimeout = setTimeout(() => {
        // Check if we're still in 'calling' state and no peer connections exist
        // This means the receiver never accepted the call (timeout, not explicit rejection)
        if (callStateRef.current === 'calling' && peerConnections.current.size === 0) {
          console.log('⏱️ Call timeout - receiver did not respond');
          alert("The call was not answered.");
          cleanup(false);
        }
      }, 30000); // 30 seconds timeout
      
      // Store timeout ref to clear it if call is accepted or rejected
      (notifyChannelRef.current as any).rejectionTimeout = rejectionTimeout;
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

      // Use provided stream if available (from button click handler), otherwise request it
      // CRITICAL FOR MOBILE: If stream is not provided, call getUserMedia IMMEDIATELY
      // On mobile browsers (especially iOS Safari), getUserMedia must be called directly
      // from a user gesture without async delays, otherwise permission will be denied
      const stream = providedStream || await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
      
      // Audio unlock can happen after getUserMedia (non-blocking for mobile)
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        audio.play().catch(e => console.warn('Dummy audio play failed. Autoplay might not work.', e));
      } catch (e) {
        console.warn('Dummy audio play failed. Autoplay might not work.', e);
      }
      localStream.current = stream;
      
      // Process stream with background if video call
      // Read from localStorage directly to ensure we have the latest value
      // ALWAYS read fresh from localStorage - never use cached state
      const currentBackground = typeof window !== 'undefined' 
        ? (localStorage.getItem('selectedBackground') || 'none')
        : 'none';
      
      // Double-check: log both localStorage and state to debug any mismatches
      const localStorageValue = typeof window !== 'undefined' ? localStorage.getItem('selectedBackground') : null;
      console.log('🔍 [INITIATE CALL] Background check - type:', type, 'currentBackground:', currentBackground, 'from localStorage:', localStorageValue, 'from state:', selectedBackground);
      
      // Verify we're using the correct background
      if (localStorageValue && localStorageValue !== currentBackground) {
        console.warn('⚠️ [INITIATE CALL] Background mismatch detected! localStorage:', localStorageValue, 'currentBackground:', currentBackground);
      }
      
      let streamToUse = stream;
      if (type === 'video' && currentBackground !== 'none') {
        try {
          console.log('🎨 [INITIATE CALL] Initiating background processing for video call, background:', currentBackground);
          console.log('📊 [INITIATE CALL] Original stream has', stream.getVideoTracks().length, 'video tracks');
          streamToUse = await processVideoWithBackground(stream, currentBackground);
          processedStreamRef.current = streamToUse;
          console.log('✅ [INITIATE CALL] Background processing complete, processed stream has', streamToUse.getVideoTracks().length, 'video tracks');
          console.log('📊 [INITIATE CALL] Processed stream track IDs:', streamToUse.getVideoTracks().map(t => t.id));
          console.log('📊 [INITIATE CALL] Streams are different:', streamToUse !== stream);
        } catch (error) {
          console.error('❌ [INITIATE CALL] Failed to process video with background, using original stream:', error);
          console.error('❌ [INITIATE CALL] Error details:', error instanceof Error ? error.message : String(error));
          console.error('❌ [INITIATE CALL] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          streamToUse = stream; // Fallback to original stream
          processedStreamRef.current = null;
        }
      } else {
        console.log('⏭️ [INITIATE CALL] No background processing needed (type:', type, ', background:', currentBackground, ')');
        if (type === 'video') {
          console.warn('⚠️ [INITIATE CALL] Video call but background is "none" - background will not be applied!');
        }
        processedStreamRef.current = null;
      }
      
      const initialCameraOff = type === 'audio';
      setIsCameraOff(initialCameraOff);
      streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      // Set local peer but keep state as 'calling' until receiver accepts
      // Create new peer object with updateKey to force re-render on subsequent calls
      const newUpdateKey = streamUpdateKey + 1;
      setStreamUpdateKey(newUpdateKey);
      const peerStream = streamToUse;
      console.log('📊 [INITIATE CALL] Setting peer with stream that has', peerStream.getVideoTracks().length, 'video tracks');
      console.log('📊 [INITIATE CALL] Peer stream track IDs:', peerStream.getVideoTracks().map(t => t.id));
      console.log('📊 [INITIATE CALL] Peer stream ID:', peerStream.id);
      console.log('📊 [INITIATE CALL] Original stream ID:', stream.id);
      console.log('📊 [INITIATE CALL] Using processed stream:', peerStream !== stream);
      setPeers(new Map([[currentUser.id, { 
        id: currentUser.id, 
        stream: peerStream, 
        isLocal: true, 
        user: currentUser,
        updateKey: newUpdateKey // Force re-render with new stream
      }]]));
      console.log('✅ [INITIATE CALL] Peer set with stream, updateKey:', newUpdateKey, 'isProcessed:', peerStream !== stream);
      // DON'T set callState to 'active' yet - wait for receiver to accept
      // callState remains 'calling' until we receive a 'join' signal from the receiver

      const channel = supabase.channel(roomId);
      channelRef.current = channel;
      console.log('📡 [SENDER] Created channel with roomId:', roomId);

      // CRITICAL: Ensure handleSignalRef is set before setting up channel handlers
      // This prevents race condition where handlers are set up before handleSignal is available
      if (!handleSignalRef.current) {
        console.warn('⚠️ handleSignalRef is null in initiateCall, setting it now');
        handleSignalRef.current = handleSignal;
      }

      // Listen for rejection signal on room channel
      channel.on('broadcast', { event: 'call-rejected' }, ({ payload }) => {
        console.log('📨 Received call-rejected signal on room channel:', payload, 'Current callState:', callStateRef.current, 'activeChat.id:', activeChat?.id);
        // Only process if this rejection is for the current call
        if (callStateRef.current === 'calling' && payload.rejectedBy === activeChat?.id) {
          console.log('❌ Call rejected by receiver (via room channel):', payload);
          // Clear rejection timeout since we got explicit rejection
          if ((notifyChannelRef.current as any)?.rejectionTimeout) {
            clearTimeout((notifyChannelRef.current as any).rejectionTimeout);
            (notifyChannelRef.current as any).rejectionTimeout = null;
          }
          alert(`The call was rejected${payload.rejectedByUsername ? ` by ${payload.rejectedByUsername}` : ''}.`);
          cleanup(false);
        }
      });

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          console.log('📨 [RECEIVER] Signal received on channel:', payload.type, 'from:', payload.senderId, 'channel state:', channel.state);
          // Use ref to access handleSignal to avoid dependency issues
          if (handleSignalRef.current) {
            console.log('✅ [RECEIVER] Calling handleSignal for signal type:', payload.type);
            handleSignalRef.current(payload, channel);
          } else {
            console.error('❌ handleSignalRef is null when signal received! This should not happen.');
          }
        })
        .subscribe((status) => {
          console.log('📡 [RECEIVER] Channel subscription status:', status, 'roomId:', roomId);
          if (status === 'SUBSCRIBED') {
            console.log('✅ [RECEIVER] Channel subscribed, sending join signal');
            channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
          }
        });
    } catch (err: any) {
      console.error("Failed to get media:", err);
      let errorMessage = "Could not access Camera/Microphone. ";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        // Mark permission as denied to prevent retry loop
        permissionDeniedRef.current = true;
        // Provide mobile-specific instructions
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
          errorMessage += "On mobile devices, please:\n1. Tap the button again to grant permission\n2. Make sure you're using HTTPS (required for camera/microphone)\n3. For iOS Safari, try adding the site to your home screen";
        } else {
          errorMessage += "Please allow camera/microphone access in your browser settings.";
        }
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
  
  // Wrapper for backward compatibility (calls initiateCallWithStream without stream)
  const initiateCall = useCallback(async (type: 'audio' | 'video', notify: boolean) => {
    return initiateCallWithStream(type, notify);
  }, [initiateCallWithStream]);
  
  // Auto-join when accepting incoming call
  useEffect(() => {
    // Don't auto-join if permission was denied (prevents retry loop)
    if (permissionDeniedRef.current) {
      console.log('⏭️ Skipping auto-join because permission was denied');
      return;
    }
    
    if (incomingMode && callState === 'idle' && !localStream.current && !hasJoinedRef.current) {
      // For accepted incoming calls, auto-join instead of prompting
      console.log('📞 Auto-join triggered: incomingMode:', incomingMode, 'callState:', callState, 'hasJoined:', hasJoinedRef.current);
      hasJoinedRef.current = true; // Mark that we're joining
      const autoJoin = async () => {
        setCallType(incomingMode);
        setCallState('calling');
        callStateRef.current = 'calling';
        
        // Browser compatibility check
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
          await cleanup(false);
          return;
        }

        try {
          // CRITICAL FOR MOBILE: Call getUserMedia IMMEDIATELY while user gesture is still valid
          // On mobile browsers (especially iOS Safari), getUserMedia must be called directly
          // from a user gesture without async delays, otherwise permission will be denied
          const stream = await navigator.mediaDevices.getUserMedia({ video: incomingMode === 'video', audio: true });
          
          // Audio unlock can happen after getUserMedia (non-blocking for mobile)
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
            audio.play().catch(e => console.warn('Dummy audio play failed. Autoplay might not work.', e));
          } catch (e) {
            console.warn('Dummy audio play failed. Autoplay might not work.', e);
          }
          localStream.current = stream;
          
          // Process stream with background if video call
          // Read from localStorage directly to ensure we have the latest value
          // ALWAYS read fresh from localStorage - never use cached state
          const currentBackground = typeof window !== 'undefined' 
            ? (localStorage.getItem('selectedBackground') || 'none')
            : 'none';
          
          // Double-check: log both localStorage and state to debug any mismatches
          const localStorageValue = typeof window !== 'undefined' ? localStorage.getItem('selectedBackground') : null;
          console.log('🔍 [AUTO-JOIN] Background check - incomingMode:', incomingMode, 'currentBackground:', currentBackground, 'from localStorage:', localStorageValue, 'from state:', selectedBackground);
          
          // Verify we're using the correct background
          if (localStorageValue && localStorageValue !== currentBackground) {
            console.warn('⚠️ [AUTO-JOIN] Background mismatch detected! localStorage:', localStorageValue, 'currentBackground:', currentBackground);
          }
          
          let streamToUse = stream;
          if (incomingMode === 'video' && currentBackground !== 'none') {
            try {
              console.log('🎨 [AUTO-JOIN] Initiating background processing, background:', currentBackground);
              console.log('📊 [AUTO-JOIN] Original stream has', stream.getVideoTracks().length, 'video tracks');
              streamToUse = await processVideoWithBackground(stream, currentBackground);
              processedStreamRef.current = streamToUse;
              console.log('✅ [AUTO-JOIN] Background processing complete');
              console.log('📊 [AUTO-JOIN] Processed stream has', streamToUse.getVideoTracks().length, 'video tracks');
              console.log('📊 [AUTO-JOIN] Processed stream track IDs:', streamToUse.getVideoTracks().map(t => t.id));
              console.log('📊 [AUTO-JOIN] Streams are different:', streamToUse !== stream);
              
              // Wait a bit to ensure canvas stream is producing frames before using it
              console.log('⏳ [AUTO-JOIN] Waiting for canvas stream to be ready...');
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log('✅ [AUTO-JOIN] Canvas stream should be ready now');
            } catch (error) {
              console.error('❌ [AUTO-JOIN] Failed to process video with background, using original stream:', error);
              console.error('❌ [AUTO-JOIN] Error details:', error instanceof Error ? error.message : String(error));
              console.error('❌ [AUTO-JOIN] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
              streamToUse = stream; // Fallback to original stream
              processedStreamRef.current = null;
            }
          } else {
            console.log('⏭️ [AUTO-JOIN] No background processing needed (incomingMode:', incomingMode, ', background:', currentBackground, ')');
            if (incomingMode === 'video') {
              console.warn('⚠️ [AUTO-JOIN] Video call but background is "none" - background will not be applied!');
            }
            processedStreamRef.current = null;
          }
          
          const initialCameraOff = incomingMode === 'audio';
          setIsCameraOff(initialCameraOff);
          streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
          
          // Set local peer but keep state as 'calling' until receiver accepts (for receiver, this is fine)
          // Create new peer object with updateKey to force re-render on subsequent calls
          const newUpdateKey = streamUpdateKey + 1;
          setStreamUpdateKey(newUpdateKey);
          const peerStream = streamToUse;
          console.log('📊 [AUTO-JOIN] Setting peer with stream that has', peerStream.getVideoTracks().length, 'video tracks');
          console.log('📊 [AUTO-JOIN] Peer stream track IDs:', peerStream.getVideoTracks().map(t => t.id));
          console.log('📊 [AUTO-JOIN] Peer stream ID:', peerStream.id);
          console.log('📊 [AUTO-JOIN] Original stream ID:', stream.id);
          console.log('📊 [AUTO-JOIN] Using processed stream:', peerStream !== stream);
          setPeers(new Map([[currentUser.id, { 
            id: currentUser.id, 
            stream: peerStream, 
            isLocal: true, 
            user: currentUser,
            updateKey: newUpdateKey // Force re-render with new stream
          }]]));
          console.log('✅ [AUTO-JOIN] Peer set with stream, updateKey:', newUpdateKey, 'isProcessed:', peerStream !== stream);
          // For receiver (auto-join), set to active immediately since they're accepting
          setCallState('active');
          callStateRef.current = 'active';

          const channel = supabase.channel(roomId);
          channelRef.current = channel;
          console.log('📡 [RECEIVER AUTO-JOIN] Created channel with roomId:', roomId);

          // CRITICAL: Ensure handleSignalRef is set before setting up channel handlers
          // Try to get handleSignal from the component scope first
          // If not available, wait for it to be set by useEffect
          if (!handleSignalRef.current) {
            console.warn('⚠️ handleSignalRef is null in auto-join, waiting for it...');
            let retries = 0;
            while (!handleSignalRef.current && retries < 20) {
              await new Promise(resolve => setTimeout(resolve, 50));
              retries++;
            }
            
            // If still null after waiting, try to set it directly if handleSignal is available
            // Note: handleSignal might not be in scope here, so we rely on the useEffect
            if (!handleSignalRef.current) {
              console.error('❌ handleSignalRef is still null after waiting! This is a critical error.');
              console.error('❌ This usually means handleSignal useEffect has not run yet. Component may need to re-render.');
              // Don't fail completely - set up handler with a check
              // The useEffect should set it soon
            }
          }

          if (handleSignalRef.current) {
            console.log('✅ handleSignalRef is ready in auto-join');
          } else {
            console.warn('⚠️ handleSignalRef is still null, but continuing - will check again when signal arrives');
          }

          // Use a ref to access handleSignal to avoid dependency issues
          channel
            .on('broadcast', { event: 'signal' }, ({ payload }) => {
              console.log('📨 [RECEIVER AUTO-JOIN] Signal received on channel:', payload.type, 'from:', payload.senderId, 'channel state:', channel.state);
              // Use ref to access handleSignal to avoid dependency issues
              if (handleSignalRef.current) {
                console.log('✅ [RECEIVER AUTO-JOIN] Calling handleSignal for signal type:', payload.type);
                handleSignalRef.current(payload, channel);
              } else {
                console.error('❌ handleSignalRef is null when signal received in auto-join! This should not happen.');
                // Try to wait a bit and retry - the useEffect might set it soon
                console.log('⏳ Waiting for handleSignalRef to be set...');
                let retries = 0;
                const checkAndProcess = () => {
                  if (handleSignalRef.current) {
                    console.log('✅ handleSignalRef is now available, processing signal');
                    handleSignalRef.current(payload, channel);
                  } else if (retries < 10) {
                    retries++;
                    setTimeout(checkAndProcess, 50);
                  } else {
                    console.error('❌ handleSignalRef is still null after retries. Signal may be lost:', payload.type);
                  }
                };
                setTimeout(checkAndProcess, 50);
              }
            })
            .subscribe((status) => {
              console.log('📡 [RECEIVER AUTO-JOIN] Channel subscription status:', status, 'roomId:', roomId);
              if (status === 'SUBSCRIBED') {
                console.log('✅ [RECEIVER AUTO-JOIN] Channel subscribed, sending join signal');
                channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
              }
            });
        } catch (err: any) {
          console.error("Failed to get media:", err);
          let errorMessage = "Could not access Camera/Microphone. ";
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            // Mark permission as denied to prevent retry loop
            permissionDeniedRef.current = true;
            // Keep hasJoinedRef true to prevent retry
            hasJoinedRef.current = true;
            errorMessage += "Please allow camera/microphone access in your browser settings.";
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            errorMessage += "No camera/microphone found. Please connect a device.";
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            errorMessage += "Device is being used by another application.";
          } else {
            errorMessage += "Please check permissions and try again.";
          }
          alert(errorMessage);
          // Clear incomingMode by calling onCallEnd to prevent retry loop
          onCallEnd();
          await cleanup(false);
        }
      };
      
      autoJoin();
    }
    // Reset hasJoinedRef and permissionDeniedRef when incomingMode becomes null (call ended or cleared)
    if (!incomingMode && hasJoinedRef.current) {
      console.log('🔄 Resetting hasJoinedRef because incomingMode is null');
      hasJoinedRef.current = false;
      // Also reset permission denied flag when call is cleared
      if (permissionDeniedRef.current) {
        console.log('🔄 Resetting permissionDeniedRef because incomingMode is null');
        permissionDeniedRef.current = false;
      }
    }
    // Also reset if callState goes back to idle (call ended)
    if (callState === 'idle' && hasJoinedRef.current && !incomingMode) {
      console.log('🔄 Resetting hasJoinedRef because callState is idle and no incomingMode');
      hasJoinedRef.current = false;
      // Also reset permission denied flag
      if (permissionDeniedRef.current) {
        console.log('🔄 Resetting permissionDeniedRef because callState is idle');
        permissionDeniedRef.current = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingMode, callState]); // Note: handleSignal is not in scope here, we rely on handleSignalRef being set by useEffect at line 1535

  // --- CORE LOGIC: JOIN CALL (AFTER USER CLICK) ---
  const joinCall = useCallback(async () => {
    // Browser compatibility check
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
      await cleanup(false);
      return;
    }

    // Reset permission denied flag when user manually joins
    // This allows them to try again after a previous denial
    if (permissionDeniedRef.current) {
      console.log('🔄 [JOIN CALL] Resetting permission denied flag for manual retry');
      permissionDeniedRef.current = false;
    }

    if (!callType) return;
    setCallState('calling');
    callStateRef.current = 'calling';
    try {
      // CRITICAL FOR MOBILE: Call getUserMedia IMMEDIATELY while user gesture is still valid
      // On mobile browsers (especially iOS Safari), getUserMedia must be called directly
      // from a user gesture without async delays, otherwise permission will be denied
      const stream = await navigator.mediaDevices.getUserMedia({ video: callType === 'video', audio: true });
      
      // Audio unlock can happen after getUserMedia (non-blocking for mobile)
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        audio.play().catch(e => console.warn('Dummy audio play failed. Autoplay might not work.', e));
      } catch (e) {
        console.warn('Dummy audio play failed. Autoplay might not work.', e);
      }
      localStream.current = stream;
      
      // Process stream with background if video call
      // Read from localStorage directly to ensure we have the latest value
      // ALWAYS read fresh from localStorage - never use cached state
      const currentBackground = typeof window !== 'undefined' 
        ? (localStorage.getItem('selectedBackground') || 'none')
        : 'none';
      
      // Double-check: log both localStorage and state to debug any mismatches
      const localStorageValue = typeof window !== 'undefined' ? localStorage.getItem('selectedBackground') : null;
      console.log('🔍 [JOIN CALL] Background check - callType:', callType, 'currentBackground:', currentBackground, 'from localStorage:', localStorageValue, 'from state:', selectedBackground);
      
      // Verify we're using the correct background
      if (localStorageValue && localStorageValue !== currentBackground) {
        console.warn('⚠️ [JOIN CALL] Background mismatch detected! localStorage:', localStorageValue, 'currentBackground:', currentBackground);
      }
      
      let streamToUse = stream;
      if (callType === 'video' && currentBackground !== 'none') {
        try {
          console.log('🎨 [JOIN CALL] Initiating background processing, background:', currentBackground);
          console.log('📊 [JOIN CALL] Original stream has', stream.getVideoTracks().length, 'video tracks');
          streamToUse = await processVideoWithBackground(stream, currentBackground);
          processedStreamRef.current = streamToUse;
          console.log('✅ [JOIN CALL] Background processing complete');
          console.log('📊 [JOIN CALL] Processed stream has', streamToUse.getVideoTracks().length, 'video tracks');
          console.log('📊 [JOIN CALL] Processed stream track IDs:', streamToUse.getVideoTracks().map(t => t.id));
          console.log('📊 [JOIN CALL] Streams are different:', streamToUse !== stream);
        } catch (error) {
          console.error('❌ [JOIN CALL] Failed to process video with background, using original stream:', error);
          console.error('❌ [JOIN CALL] Error details:', error instanceof Error ? error.message : String(error));
          console.error('❌ [JOIN CALL] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          streamToUse = stream; // Fallback to original stream
          processedStreamRef.current = null;
        }
      } else {
        console.log('⏭️ [JOIN CALL] No background processing needed (callType:', callType, ', background:', currentBackground, ')');
        if (callType === 'video') {
          console.warn('⚠️ [JOIN CALL] Video call but background is "none" - background will not be applied!');
        }
        processedStreamRef.current = null;
      }
      
      const initialCameraOff = callType === 'audio';
      setIsCameraOff(initialCameraOff);
      streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      // Create new peer object with updateKey to force re-render on subsequent calls
      const newUpdateKey = streamUpdateKey + 1;
      setStreamUpdateKey(newUpdateKey);
      const peerStream = streamToUse;
      console.log('📊 [JOIN CALL] Setting peer with stream that has', peerStream.getVideoTracks().length, 'video tracks');
      console.log('📊 [JOIN CALL] Peer stream track IDs:', peerStream.getVideoTracks().map(t => t.id));
      console.log('📊 [JOIN CALL] Peer stream ID:', peerStream.id);
      console.log('📊 [JOIN CALL] Original stream ID:', stream.id);
      console.log('📊 [JOIN CALL] Using processed stream:', peerStream !== stream);
      setPeers(new Map([[currentUser.id, { 
        id: currentUser.id, 
        stream: peerStream, 
        isLocal: true, 
        user: currentUser,
        updateKey: newUpdateKey // Force re-render with new stream
      }]]));
      console.log('✅ [JOIN CALL] Peer set with stream, updateKey:', newUpdateKey, 'isProcessed:', peerStream !== stream);
      setCallState('active');
      callStateRef.current = 'active';

      const channel = supabase.channel(roomId);
      channelRef.current = channel;
      console.log('📡 [RECEIVER JOIN] Created channel with roomId:', roomId);

      // CRITICAL: Ensure handleSignalRef is set before setting up channel handlers
      if (!handleSignalRef.current) {
        console.warn('⚠️ handleSignalRef is null in joinCall, setting it now');
        handleSignalRef.current = handleSignal;
      }

      // Listen for rejection signal on room channel
      channel.on('broadcast', { event: 'call-rejected' }, ({ payload }) => {
        console.log('📨 Received call-rejected signal on room channel:', payload, 'Current callState:', callStateRef.current, 'activeChat.id:', activeChat?.id);
        // Only process if this rejection is for the current call
        if (callStateRef.current === 'calling' && payload.rejectedBy === activeChat?.id) {
          console.log('❌ Call rejected by receiver (via room channel):', payload);
          // Clear rejection timeout since we got explicit rejection
          if ((notifyChannelRef.current as any)?.rejectionTimeout) {
            clearTimeout((notifyChannelRef.current as any).rejectionTimeout);
            (notifyChannelRef.current as any).rejectionTimeout = null;
          }
          alert(`The call was rejected${payload.rejectedByUsername ? ` by ${payload.rejectedByUsername}` : ''}.`);
          cleanup(false);
        }
      });

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          console.log('📨 [RECEIVER JOIN] Signal received on channel:', payload.type, 'from:', payload.senderId, 'channel state:', channel.state);
          // Use ref to access handleSignal to avoid dependency issues
          if (handleSignalRef.current) {
            console.log('✅ [RECEIVER JOIN] Calling handleSignal for signal type:', payload.type);
            handleSignalRef.current(payload, channel);
          } else {
            console.error('❌ handleSignalRef is null when signal received in joinCall! This should not happen.');
          }
        })
        .subscribe((status) => {
          console.log('📡 [RECEIVER JOIN] Channel subscription status:', status, 'roomId:', roomId);
          if (status === 'SUBSCRIBED') {
            console.log('✅ [RECEIVER JOIN] Channel subscribed, sending join signal');
            channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, user: currentUser } });
          }
        });
    } catch (err: any) {
      console.error("Failed to get media:", err);
      let errorMessage = "Could not access Camera/Microphone. ";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        // Mark permission as denied to prevent retry loop
        permissionDeniedRef.current = true;
        // Provide mobile-specific instructions
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
          errorMessage += "On mobile devices, please:\n1. Tap the button again to grant permission\n2. Make sure you're using HTTPS (required for camera/microphone)\n3. For iOS Safari, try adding the site to your home screen";
        } else {
          errorMessage += "Please allow camera/microphone access in your browser settings.";
        }
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
      console.log(`📥 Received track from ${remoteId}:`, {
        kind: e.track.kind,
        id: e.track.id,
        enabled: e.track.enabled,
        readyState: e.track.readyState,
        streams: e.streams.length,
        streamIds: e.streams.map(s => s.id)
      });
      
      // Aggregate all tracks from all streams in the event
      const allTracks: MediaStreamTrack[] = [];
      e.streams.forEach(stream => {
        stream.getTracks().forEach(track => {
          allTracks.push(track);
        });
      });
      
      // Also add the track from the event itself (in case it's not in streams)
      if (e.track && !allTracks.find(t => t.id === e.track.id)) {
        allTracks.push(e.track);
      }
      
      console.log(`📥 Aggregated ${allTracks.length} tracks from event for ${remoteId}:`, 
        allTracks.map(t => `${t.kind}:${t.id}`));
      
      // If we already have a peer for this remoteId, merge tracks
      setPeers(prev => {
        const existing = prev.get(remoteId);
        const wasEmpty = prev.size === 0 || (prev.size === 1 && prev.has(currentUser.id));
        
        if (existing && existing.stream) {
          // Check which tracks are new
          const existingTrackIds = new Set(existing.stream.getTracks().map(t => t.id));
          const newTracks = allTracks.filter(track => !existingTrackIds.has(track.id));
          
          if (newTracks.length > 0) {
            console.log(`➕ Adding ${newTracks.length} new tracks to existing stream for ${remoteId}:`, 
              newTracks.map(t => `${t.kind}:${t.id}`));
            
            // Create a NEW MediaStream with all tracks (old + new) to trigger React update
            const updatedStream = new MediaStream();
            
            // Add all existing tracks
            existing.stream.getTracks().forEach(track => {
              updatedStream.addTrack(track);
            });
            
            // Add all new tracks
            newTracks.forEach(track => {
              updatedStream.addTrack(track);
              console.log(`✅ Added ${track.kind} track (${track.id}) to stream for ${remoteId}`);
            });
            
            console.log(`📊 Updated stream for ${remoteId} now has:`, {
              video: updatedStream.getVideoTracks().length,
              audio: updatedStream.getAudioTracks().length,
              total: updatedStream.getTracks().length
            });
            
            // Create new peer entry with new stream reference to trigger React update
            const newPeers = new Map(prev).set(remoteId, { 
              ...existing, 
              stream: updatedStream // NEW stream reference
            });
            
            // Update call state to active when first remote track is received
            if (wasEmpty) {
              console.log('✅ Updating callState to active after receiving first remote track');
              setCallState('active');
              callStateRef.current = 'active';
            }
            
            return newPeers;
          } else {
            console.log(`⚠️ No new tracks to add for ${remoteId} (all ${allTracks.length} tracks already exist)`);
            return prev;
          }
        } else {
          // Create new peer entry with a new stream containing all tracks
          const newStream = new MediaStream();
          allTracks.forEach(track => {
            newStream.addTrack(track);
            console.log(`✅ Added ${track.kind} track (${track.id}) to new stream for ${remoteId}`);
          });
          
          console.log(`🆕 Creating new peer entry for ${remoteId} with stream:`, {
            video: newStream.getVideoTracks().length,
            audio: newStream.getAudioTracks().length,
            total: newStream.getTracks().length,
            trackIds: newStream.getTracks().map(t => `${t.kind}:${t.id}`)
          });
          
          const newPeers = new Map(prev).set(remoteId, { 
            id: remoteId, 
            stream: newStream, 
            user, 
            isLocal: false 
          });
          
          // Update call state to active when first remote peer is added
          if (wasEmpty) {
            console.log('✅ Updating callState to active after adding first remote peer');
            setCallState('active');
            callStateRef.current = 'active';
          }
          
          return newPeers;
        }
      });
    };
    
    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`[RECEIVER] Connection state for ${remoteId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        console.warn(`[RECEIVER] Connection ${pc.connectionState} for peer ${remoteId}`);
        
        // FALLBACK: If connection is closed and we're in an active call, the other user likely ended the call
        // Only trigger this if we're in 'active' state (not during initial connection)
        // and this is the caller (remoteId matches activeChat.id)
        if (pc.connectionState === 'closed' && callStateRef.current === 'active' && !isGroup && activeChat && remoteId === activeChat.id) {
          console.log('📞 [RECEIVER FALLBACK] Peer connection closed - caller likely ended the call');
          // Use a flag to prevent duplicate alerts if leave signal arrives
          const connectionClosedRef = { handled: false };
          
          setTimeout(() => {
            // Double-check that we still don't have this peer (leave signal would have removed it)
            // and that we haven't already handled this
            if (!connectionClosedRef.handled && !peerConnections.current.has(remoteId) && callStateRef.current !== 'idle') {
              console.log('📞 [RECEIVER FALLBACK] Showing alert for connection closed');
              connectionClosedRef.handled = true;
              alert("The other user has ended the call.");
              cleanup(false);
            }
          }, 1000);
        }
        // Log but don't auto-cleanup immediately - let periodic monitoring or leave signal handle it
        // This prevents premature cleanup during normal connection establishment
      } else if (pc.connectionState === 'connected') {
        console.log(`[RECEIVER] Successfully connected to peer ${remoteId}`);
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
        // Log but don't auto-cleanup - let periodic monitoring handle it
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log(`ICE connection ${pc.iceConnectionState} for peer ${remoteId}`);
      }
    };
    
    // Use processed stream if available, otherwise use original stream
    const streamToSend = processedStreamRef.current || localStream.current;
    if (processedStreamRef.current) {
      console.log('📤 createPeer: Using processed stream with background for peer connection to', remoteId, 'tracks:', processedStreamRef.current.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
    } else {
      console.log('📤 createPeer: Using original stream (no background) for peer connection to', remoteId);
    }
    streamToSend?.getTracks().forEach(track => {
      console.log('➕ createPeer: Adding track to peer connection:', track.kind, 'enabled:', track.enabled, 'readyState:', track.readyState);
      pc.addTrack(track, streamToSend!);
    });
    
    return pc;
  }, [currentUser.id, isGroup, activeChat]);
  
  const handleSignal = useCallback(async (payload: any, channel: any) => {
    const { type, senderId, targetId, sdp, candidate, user } = payload;
    console.log('🔔 [handleSignal] Processing signal:', type, 'from:', senderId, 'to:', targetId, 'currentUser:', currentUser.id);
    if (senderId === currentUser.id) {
      console.log('⏭️ [handleSignal] Ignoring signal from self');
      return;
    }

    let pc = peerConnections.current.get(senderId);

    try {
      switch (type) {
        // THIS LOGIC PREVENTS THE RACE CONDITION
        case 'join':
          // A new user joined. This peer (already in the call) creates and sends an offer.
          if (!pc) pc = createPeer(senderId, channel, user);
          
          // If we're the sender (caller) and receiver just joined, transition to 'active'
          // Check if we're in 'calling' state and this is the receiver joining
          if (callState === 'calling' && senderId === activeChat.id) {
            console.log('✅ Receiver joined the call, transitioning to active state');
            setCallState('active');
            callStateRef.current = 'active';
            
            // Clear rejection timeout since receiver accepted
            if (notifyChannelRef.current && (notifyChannelRef.current as any).rejectionTimeout) {
              clearTimeout((notifyChannelRef.current as any).rejectionTimeout);
              (notifyChannelRef.current as any).rejectionTimeout = null;
            }
          }
          
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
              const streamToUse = processedStreamRef.current || localStream.current;
              if (streamToUse && streamToUse.getTracks().length > 0) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log(`Created offer for ${senderId}, tracks in SDP:`, streamToUse.getTracks().map(t => t.kind));
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
                  callStateRef.current = 'active';
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
                      callStateRef.current = 'active';
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
          // Prevent duplicate processing of the same leave signal
          if (leaveSignalProcessedRef.current.has(senderId)) {
            console.log('⏭️ [RECEIVER] Leave signal already processed for', senderId, '- ignoring duplicate');
            return;
          }
          
          console.log('📨 [RECEIVER] Received leave signal from:', senderId, 'Current callState:', callState, 'activeChat.id:', activeChat?.id, 'isGroup:', isGroup);
          
          // Mark as processed immediately to prevent duplicates
          leaveSignalProcessedRef.current.add(senderId);
          
          // Close peer connection for the leaving user
          if (peerConnections.current.has(senderId)) {
            console.log('🔌 [RECEIVER] Closing peer connection for', senderId);
            peerConnections.current.get(senderId)?.close();
            peerConnections.current.delete(senderId);
          }
          
          // Remove peer from state
          setPeers(prev => {
            const newPeers = new Map(prev);
            if (newPeers.has(senderId)) {
              console.log('🗑️ [RECEIVER] Removing peer from state:', senderId);
              newPeers.delete(senderId);
            }
            return newPeers;
          });
          
          if (!isGroup) {
            // Determine if this is the caller (sender) or receiver ending the call
            // If senderId matches activeChat.id, it means the caller (the person we're chatting with) ended the call
            const isCallerEnding = senderId === activeChat.id;
            
            console.log('📞 [RECEIVER] Processing leave signal - isCallerEnding:', isCallerEnding, 'callState:', callState);
            
            // Show alert synchronously - alert() is blocking and will wait for user to click OK
            // This ensures the alert is displayed before any cleanup happens
            if (isCallerEnding) {
              console.log('📞 [RECEIVER] Caller ended the call - showing alert');
              try {
                // Call alert synchronously - it will block until user clicks OK
                alert("The other user has ended the call.");
                console.log('✅ [RECEIVER] Alert acknowledged by user');
              } catch (err) {
                console.error('❌ [RECEIVER] Error showing alert:', err);
              }
              
              // Cleanup after alert is acknowledged (alert is blocking, so this runs after user clicks OK)
              console.log('🧹 [RECEIVER] Starting cleanup after alert');
              console.log('🧹 [RECEIVER] Pre-cleanup state:', {
                callState: callState,
                callStateRef: callStateRef.current,
                peersSize: peers.size,
                peerConnectionsSize: peerConnections.current.size,
                hasLocalStream: !!localStream.current,
                hasChannel: !!channelRef.current,
                hasProcessedStream: !!processedStreamRef.current
              });
              cleanup(false).then(() => {
                console.log('✅ [RECEIVER] Cleanup completed after leave signal');
                console.log('✅ [RECEIVER] Post-cleanup state:', {
                  callState: callState,
                  callStateRef: callStateRef.current,
                  peersSize: peers.size,
                  peerConnectionsSize: peerConnections.current.size,
                  hasLocalStream: !!localStream.current,
                  hasChannel: !!channelRef.current,
                  hasProcessedStream: !!processedStreamRef.current
                });
              }).catch(err => console.error('❌ [RECEIVER] Error during cleanup after leave:', err));
            } else {
              // This shouldn't happen in direct calls, but handle it anyway
              console.log('⚠️ [RECEIVER] Unexpected leave signal from non-caller');
              try {
                alert("The other user has ended the call.");
                console.log('✅ [RECEIVER] Alert acknowledged by user');
              } catch (err) {
                console.error('❌ [RECEIVER] Error showing alert:', err);
              }
              cleanup(false).catch(err => console.error('Error during cleanup after leave:', err));
            }
          } else {
            // For groups, just log the leave
            console.log('👋 [RECEIVER] User left the group call:', senderId);
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
  }, [currentUser.id, isGroup, activeChat, createPeer, cleanup]);

  // Update ref when handleSignal changes
  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  // Monitor call session activity and auto-end if inactive
  useEffect(() => {
    if (callState === 'idle') return;

    let activityCheckInterval: NodeJS.Timeout | null = null;
    let callingTimeout: NodeJS.Timeout | null = null;
    let startMonitoringDelay: NodeJS.Timeout | null = null;

    // Don't start monitoring immediately - give the call time to establish
    startMonitoringDelay = setTimeout(() => {
      const checkCallActivity = () => {
        // Use refs to get current state (avoid stale closures)
        // Only check if we're in active state (not during initial connection)
        // Skip check if we're still in calling state (connection in progress)
        if (callState !== 'active') return;

        // Check if local stream is still active
        if (localStream.current) {
          const videoTracks = localStream.current.getVideoTracks();
          const audioTracks = localStream.current.getAudioTracks();
          const hasActiveTracks = videoTracks.some(t => t.readyState === 'live') || 
                                 audioTracks.some(t => t.readyState === 'live');
          
          if (!hasActiveTracks) {
            console.log('🛑 Local stream tracks ended, ending call');
            cleanup(false);
            return;
          }
        }

        // Check peer connections - only end if ALL connections are failed/closed (not just disconnected temporarily)
        let hasActiveConnections = false;
        let hasFailedConnections = false;
        let hasConnectedPeers = false;
        
        peerConnections.current.forEach((pc, peerId) => {
          if (pc.connectionState === 'connected') {
            hasActiveConnections = true;
            hasConnectedPeers = true;
          } else if (pc.connectionState === 'connecting' || 
                     pc.connectionState === 'new' ||
                     (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) {
            hasActiveConnections = true; // Still trying to connect
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            hasFailedConnections = true;
          }
        });

        // For direct calls, only end if we have no active connections AND all are failed (not just disconnected)
        if (!isGroup) {
          // Only end if we have remote peers but ALL connections are failed/closed
          const hasRemotePeers = Array.from(peers.values()).some(p => !p.isLocal);
          if (hasRemotePeers && !hasActiveConnections && hasFailedConnections && peerConnections.current.size > 0) {
            // Double check - make sure all connections are truly failed
            let allTrulyFailed = true;
            peerConnections.current.forEach((pc) => {
              if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') {
                allTrulyFailed = false;
              }
            });
            
            if (allTrulyFailed) {
              console.log('🛑 All peer connections failed, ending call');
              alert('Connection lost. Ending call.');
              cleanup(false);
              return;
            }
          }
        }

        // Check if channel is still connected
        if (channelRef.current) {
          const channelState = channelRef.current.state;
          if (channelState === 'closed' || channelState === 'error') {
            console.log('🛑 Channel disconnected, ending call');
            cleanup(false);
            return;
          }
        }
      };

      // Set up periodic check every 10 seconds (less aggressive)
      activityCheckInterval = setInterval(checkCallActivity, 10000);
    }, 10000); // Wait 10 seconds before starting monitoring

    // Also set a timeout for calls stuck in 'calling' state
    if (callState === 'calling') {
      callingTimeout = setTimeout(() => {
        // Re-check state before ending
        let stillNoConnections = true;
        
        // Check current state of peer connections
        peerConnections.current.forEach((pc) => {
          if (pc.connectionState === 'connected' || 
              pc.connectionState === 'connecting' ||
              pc.connectionState === 'new' ||
              (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) {
            stillNoConnections = false;
          }
        });
        
        // If still no connections after timeout, end the call
        if (stillNoConnections) {
          console.log('🛑 Call stuck in calling state for too long, ending call');
          if (!isGroup) {
            alert('Call connection timeout. Ending call.');
          }
          cleanup(false);
        }
      }, 60000); // 60 seconds timeout (more lenient)
    }

    return () => {
      if (startMonitoringDelay) clearTimeout(startMonitoringDelay);
      if (activityCheckInterval) clearInterval(activityCheckInterval);
      if (callingTimeout) clearTimeout(callingTimeout);
    };
  }, [callState, callType, peers.size, isGroup, cleanup]);

  // --- UI CONTROLS ---
  const toggleMic = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => { track.enabled = !track.enabled; });
      setIsMicMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (callType === 'video') {
      // Toggle on the original stream (which feeds the processed stream)
      if (localStream.current) {
        localStream.current.getVideoTracks().forEach(track => { track.enabled = !track.enabled; });
      }
      // Also toggle on processed stream if it exists
      if (processedStreamRef.current) {
        processedStreamRef.current.getVideoTracks().forEach(track => { track.enabled = !track.enabled; });
      }
      setIsCameraOff(prev => !prev);
    }
  };

  // Handle background change
  const handleBackgroundChange = async (backgroundId: string) => {
    console.log('🎨 [BACKGROUND CHANGE] Changing background to:', backgroundId);
    // Don't update state here - it's managed by localStorage
    
    if (callType === 'video' && localStream.current && (callState === 'active' || callState === 'calling')) {
      // Get latest backgrounds from localStorage
      let latestUserBackgrounds: Array<{ id: string; name: string; url: string }> = [];
      try {
        const saved = localStorage.getItem('userBackgrounds');
        if (saved) {
          latestUserBackgrounds = JSON.parse(saved);
        }
      } catch (e) {
        console.warn('Failed to load user backgrounds from localStorage:', e);
      }
      
      // Preload background image if it's an image background (not 'none' or 'blur')
      if (backgroundId !== 'none' && backgroundId !== 'blur') {
        const allBackgrounds = [...BACKGROUND_OPTIONS, ...latestUserBackgrounds];
        const backgroundOption = allBackgrounds.find(bg => bg.id === backgroundId);
        
        console.log('🔍 [BACKGROUND CHANGE] Background lookup:', {
          backgroundId,
          found: !!backgroundOption,
          hasUrl: !!backgroundOption?.url,
          totalBackgrounds: allBackgrounds.length
        });
        
        if (backgroundOption?.url) {
          console.log('🖼️ [BACKGROUND CHANGE] Preloading background image:', backgroundOption.url);
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const imageLoaded = await new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                console.warn('⏱️ [BACKGROUND CHANGE] Background image preload timeout');
                resolve(false);
              }, 5000); // Increased timeout to 5 seconds
              
              img.onload = () => {
                clearTimeout(timeout);
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  console.log('✅ [BACKGROUND CHANGE] Background image preloaded successfully, dimensions:', img.naturalWidth, 'x', img.naturalHeight);
                  backgroundImageRef.current = img;
                  resolve(true);
                } else {
                  console.warn('⚠️ [BACKGROUND CHANGE] Background image loaded but has invalid dimensions');
                  resolve(false);
                }
              };
              
              img.onerror = () => {
                clearTimeout(timeout);
                console.warn('⚠️ [BACKGROUND CHANGE] Failed to preload background image');
                resolve(false);
              };
              
              img.src = backgroundOption.url;
            });
            
            if (!imageLoaded) {
              console.warn('⚠️ [BACKGROUND CHANGE] Background image preload failed, will retry during processing');
            }
          } catch (e) {
            console.warn('⚠️ [BACKGROUND CHANGE] Error preloading background:', e);
          }
        } else {
          console.warn('⚠️ [BACKGROUND CHANGE] Background option not found or has no URL:', backgroundId);
        }
      }
      
      // Stop old processed stream
      if (processedStreamRef.current) {
        console.log('🛑 [BACKGROUND CHANGE] Stopping old processed stream tracks');
        processedStreamRef.current.getVideoTracks().forEach(track => {
          track.stop();
          console.log('🛑 [BACKGROUND CHANGE] Stopped track:', track.id);
        });
        processedStreamRef.current = null;
      }
      if (animationFrameRef.current) {
        console.log('🛑 [BACKGROUND CHANGE] Cancelling old animation frame');
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Clean up old canvas and video elements
      if (canvasRef.current) {
        console.log('🧹 [BACKGROUND CHANGE] Cleaning up old canvas');
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        canvasRef.current = null;
      }
      if (videoElementRef.current) {
        console.log('🧹 [BACKGROUND CHANGE] Cleaning up old video element');
        videoElementRef.current.srcObject = null;
        videoElementRef.current.pause();
        videoElementRef.current = null;
      }
      
      // Wait a bit to ensure old stream is fully stopped before creating new one
      await new Promise(resolve => setTimeout(resolve, 50));

      // Process with new background
      if (backgroundId !== 'none') {
        console.log('🎨 [BACKGROUND CHANGE] Processing with new background:', backgroundId);
        try {
          const newProcessedStream = await processVideoWithBackground(localStream.current, backgroundId);
          processedStreamRef.current = newProcessedStream;
          console.log('✅ [BACKGROUND CHANGE] New processed stream created with', newProcessedStream.getVideoTracks().length, 'video tracks');
        
          // Update local peer - force update by creating completely new Map and peer object
          setPeers(prev => {
            const newPeers = new Map();
            // Copy all existing peers except local
            prev.forEach((peer, id) => {
              if (id !== currentUser.id) {
                newPeers.set(id, peer);
              }
            });
            // Create completely new local peer object with new stream
            const newUpdateKey = streamUpdateKey + 1;
            setStreamUpdateKey(newUpdateKey);
            newPeers.set(currentUser.id, {
              id: currentUser.id,
              stream: newProcessedStream,
              isLocal: true,
              user: currentUser,
              updateKey: newUpdateKey // Add update key to force re-render
            });
            console.log('🔄 [BACKGROUND CHANGE] Updated peers map with new stream, track ID:', newProcessedStream.getVideoTracks()[0]?.id, 'updateKey:', newUpdateKey);
            return newPeers;
          });

          // Force multiple updates to ensure video element refreshes
          const forceUpdates = [50, 100, 200];
          forceUpdates.forEach(delay => {
            setTimeout(() => {
              setPeers(prev => {
                const newPeers = new Map(prev);
                const localPeer = newPeers.get(currentUser.id);
                if (localPeer && processedStreamRef.current) {
                  // Create new peer object to force React update
                  const currentUpdateKey = streamUpdateKey;
                  setStreamUpdateKey(currentUpdateKey + 1);
                  newPeers.set(currentUser.id, {
                    id: currentUser.id,
                    stream: processedStreamRef.current,
                    isLocal: true,
                    user: currentUser,
                    updateKey: currentUpdateKey + 1
                  });
                  console.log(`🔄 [BACKGROUND CHANGE] Force update at ${delay}ms, track ID:`, processedStreamRef.current.getVideoTracks()[0]?.id);
                }
                return newPeers;
              });
            }, delay);
          });

          // Update all peer connections
          peerConnections.current.forEach((pc, remoteId) => {
            // Replace old video track with new one
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender && processedStreamRef.current && processedStreamRef.current.getVideoTracks().length > 0) {
              const newTrack = processedStreamRef.current.getVideoTracks()[0];
              console.log('🔄 [BACKGROUND CHANGE] Replacing video track for peer', remoteId, 'with new track:', newTrack.id);
              sender.replaceTrack(newTrack).catch(err => {
                console.error('❌ [BACKGROUND CHANGE] Error replacing track for peer', remoteId, ':', err);
              });
            } else {
              console.warn('⚠️ [BACKGROUND CHANGE] No video sender or no processed stream track for peer', remoteId);
            }
          });
        } catch (error) {
          console.error('❌ [BACKGROUND CHANGE] Error processing video with background:', error);
          // Fallback to original stream if processing fails
          processedStreamRef.current = null;
          setPeers(prev => {
            const newPeers = new Map(prev);
            const localPeer = newPeers.get(currentUser.id);
            if (localPeer && localStream.current) {
              newPeers.set(currentUser.id, { ...localPeer, stream: localStream.current });
            }
            return newPeers;
          });
        }
      } else {
        // Use original stream
        processedStreamRef.current = null;
        setPeers(prev => {
          const newPeers = new Map(prev);
          const localPeer = newPeers.get(currentUser.id);
          if (localPeer && localStream.current) {
            newPeers.set(currentUser.id, { ...localPeer, stream: localStream.current });
          }
          return newPeers;
        });

        // Update all peer connections
        peerConnections.current.forEach((pc) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender && localStream.current) {
            sender.replaceTrack(localStream.current.getVideoTracks()[0]);
          }
        });
      }
    }
  };

  // --- RENDER LOGIC ---
  if (callState === 'idle') {
    return (
      <div className="border-b border-slate-700 p-3 bg-slate-800 shrink-0" style={{ position: 'relative', zIndex: 1, minHeight: '80px' }}>
        <div className="flex flex-col gap-3">
          {/* Call Buttons */}
          <div className="flex gap-2 justify-end">
            <button 
              onClick={(e) => {
                // CRITICAL FOR MOBILE CHROME: Start getUserMedia in the absolute first statement
                // No try-catch, no checks - just call it directly and handle errors in .catch()
                // This ensures the user gesture context is preserved
                const mediaPromise = navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                
                // Handle success
                mediaPromise.then(async (stream) => {
                  await initiateCallWithStream('audio', true, stream);
                }).catch((err: any) => {
                  console.error("Failed to get media:", err);
                  
                  // Handle different error types
                  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
                    return;
                  }
                  
                  let errorMessage = "Could not access Microphone. ";
                  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                    const isChrome = /Chrome/i.test(navigator.userAgent);
                    if (isMobile && isChrome) {
                      errorMessage += "Permission denied. To fix:\n1. Tap the lock icon in Chrome's address bar\n2. Select 'Site settings'\n3. Allow 'Microphone'\n4. Refresh the page and try again";
                    } else if (isMobile) {
                      errorMessage += "On mobile devices:\n1. Make sure you're using HTTPS\n2. Check browser settings to allow microphone access\n3. Try refreshing the page and tapping again";
                    } else {
                      errorMessage += "Please allow microphone access in your browser settings.";
                    }
                  } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    errorMessage += "No microphone found. Please connect a device.";
                  } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    errorMessage += "Device is being used by another application.";
                  } else {
                    errorMessage += "Please check permissions and try again.";
                  }
                  alert(errorMessage);
                });
              }}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-full text-white text-sm"
            >
              <Phone size={18} />
            </button>
            <button 
              onClick={(e) => {
                // CRITICAL FOR MOBILE CHROME: Start getUserMedia in the absolute first statement
                // No try-catch, no checks - just call it directly and handle errors in .catch()
                // This ensures the user gesture context is preserved
                const mediaPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                
                // Handle success
                mediaPromise.then(async (stream) => {
                  await initiateCallWithStream('video', true, stream);
                }).catch((err: any) => {
                  console.error("Failed to get media:", err);
                  
                  // Handle different error types
                  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    alert("Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, Safari, or Edge.");
                    return;
                  }
                  
                  let errorMessage = "Could not access Camera/Microphone. ";
                  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                    const isChrome = /Chrome/i.test(navigator.userAgent);
                    if (isMobile && isChrome) {
                      errorMessage += "Permission denied. To fix:\n1. Tap the lock icon in Chrome's address bar\n2. Select 'Site settings'\n3. Allow 'Camera' and 'Microphone'\n4. Refresh the page and try again";
                    } else if (isMobile) {
                      errorMessage += "On mobile devices:\n1. Make sure you're using HTTPS\n2. Check browser settings to allow camera/microphone access\n3. Try refreshing the page and tapping again";
                    } else {
                      errorMessage += "Please allow camera/microphone access in your browser settings.";
                    }
                  } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    errorMessage += "No camera/microphone found. Please connect a device.";
                  } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    errorMessage += "Device is being used by another application.";
                  } else {
                    errorMessage += "Please check permissions and try again.";
                  }
                  alert(errorMessage);
                });
              }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-full text-white text-sm"
            >
              <VideoIcon size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="border-b border-slate-700 p-3 bg-slate-800 relative shrink-0" style={{ position: 'relative', zIndex: 1, minHeight: '80px', maxHeight: '500px', overflowY: 'auto' }}>
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-700 p-2 rounded-lg border border-slate-600 shadow-lg relative">
            <span className="text-green-400 text-sm font-bold flex items-center gap-2 px-2">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>
              {callState === 'calling' ? 'Connecting...' : 'Live'}
            </span>
            <div className="flex items-center gap-2 relative">
              <button onClick={toggleMic} className={`p-2 rounded-full text-white ${isMicMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}</button>
              {callType === 'video' && <button onClick={toggleCamera} className={`p-2 rounded-full text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isCameraOff ? <VideoOff size={20} /> : <VideoIcon size={20} />}</button>}
            </div>
            <button onClick={handleEndCallClick} className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-full text-white flex items-center gap-2 text-sm font-bold"><PhoneOff size={16} /> End</button>
          </div>

          <div className={`grid gap-3 ${peers.size > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {Array.from(peers.values()).map(p => <VideoPlayer key={p.id} peer={p} />)}
            {peers.size === 1 && !isGroup && callState === 'active' && <div className="flex items-center justify-center aspect-video bg-slate-700 rounded-lg border border-slate-600 text-slate-300 text-xs">Waiting for other user...</div>}
          </div>
        </div>
    </div>
  );
}

