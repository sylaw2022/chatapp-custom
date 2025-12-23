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
    
    // Update video element
    if (videoRef.current) {
      // Always update srcObject to ensure it reflects current stream state
      if (videoRef.current.srcObject !== peer.stream) {
        videoRef.current.srcObject = peer.stream;
        console.log(`📹 VideoPlayer: Updated video srcObject for peer ${peer.id}`);
      }
      // Force video to play
      videoRef.current.play().catch(e => console.warn('Video play failed:', e));
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
  const [selectedBackground, setSelectedBackground] = useState<string>('none');
  const [showBackgroundSelector, setShowBackgroundSelector] = useState(false);
  const [userBackgrounds, setUserBackgrounds] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [previewBackground, setPreviewBackground] = useState<string | null>(null);
  
  const localStream = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null); // Processed stream with background
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const backgroundSelectorRef = useRef<HTMLDivElement | null>(null);
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
    setShowBackgroundSelector(false);
    setPreviewBackground(null);
    
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

  // Close background selector when clicking outside
  useEffect(() => {
    if (!showBackgroundSelector) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (backgroundSelectorRef.current) {
        const target = event.target as HTMLElement;
        if (!backgroundSelectorRef.current.contains(target)) {
          setShowBackgroundSelector(false);
        }
      }
    };
    
    // Delay to avoid immediate closure on button click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showBackgroundSelector]);
  
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
        videoElementRef.current.srcObject = null;
        videoElementRef.current.load(); // Reset video element
      } catch (e) {
        // Ignore errors during cleanup
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
    
    // Stop processed stream tracks
    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      processedStreamRef.current = null;
    }
    
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
    console.log('🎨 Processing video with background:', backgroundId, 'Available backgrounds:', userBackgrounds.length);
    
    if (backgroundId === 'none') {
      console.log('⏭️ No background selected, returning original stream');
      return stream; // Return original stream if no background
    }

    // Stop any existing processing
    if (animationFrameRef.current) {
      console.log('🛑 Stopping existing animation frame before starting new processing');
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Also stop processing if there's an old video element with stopProcessing function
    if (videoElementRef.current && (videoElementRef.current as any)._stopProcessing) {
      console.log('🛑 Stopping old processing session before starting new one');
      try {
        (videoElementRef.current as any)._stopProcessing();
      } catch (e) {
        // Ignore errors - old processing might already be stopped
      }
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
            console.log('📊 [MediaPipe] Received segmentation results, mask available:', !!results?.segmentationMask);
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
        console.log('📊 [MediaPipe] Received segmentation results, mask available:', !!results?.segmentationMask);
      });
    }
    
    // Reset results for new processing session
    latestSegmentationResultsRef.current = null;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute to prevent feedback
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      const onLoadedMetadata = () => {
        video.play().then(() => {
          // Wait a bit more for video dimensions to be available
          setTimeout(() => {
            resolve(null);
          }, 100);
        }).catch(resolve);
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
    const allBackgrounds = [...BACKGROUND_OPTIONS, ...userBackgrounds];
    const backgroundOption = allBackgrounds.find(bg => bg.id === backgroundId);
    
    console.log('🔍 Background option found:', backgroundOption ? { id: backgroundOption.id, name: backgroundOption.name, hasUrl: !!backgroundOption.url } : 'NOT FOUND');
    
    // Load background image if needed
    let bgImage: HTMLImageElement | null = null;
    if (backgroundOption?.url && backgroundOption.url !== 'blur') {
      console.log('📷 Loading background image from URL:', backgroundOption.url);
      bgImage = new Image();
      bgImage.crossOrigin = 'anonymous';
      
      // Store in ref for potential reuse
      backgroundImageRef.current = bgImage;
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn('⏱️ Background image loading timeout');
          resolve(null); // Continue without background image
        }, 5000); // 5 second timeout
        
        bgImage!.onload = () => {
          clearTimeout(timeout);
          console.log('✅ Background image loaded successfully, dimensions:', bgImage!.naturalWidth, 'x', bgImage!.naturalHeight);
          console.log('✅ Background image complete:', bgImage!.complete, 'naturalWidth:', bgImage!.naturalWidth, 'naturalHeight:', bgImage!.naturalHeight);
          resolve(null);
        };
        bgImage!.onerror = (error) => {
          clearTimeout(timeout);
          console.error('❌ Failed to load background image:', error, 'URL:', backgroundOption.url);
          resolve(null); // Continue without background image
        };
        bgImage!.src = backgroundOption.url!;
      });
    } else if (backgroundId === 'blur') {
      console.log('🌫️ Using blur effect for background');
      backgroundImageRef.current = null;
    } else {
      console.log('⚠️ No background URL or blur effect for backgroundId:', backgroundId);
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

    const drawFrame = () => {
      // Stop animation loop if processing is no longer active or video is disposed
      if (!isProcessingActive || !video || video.readyState === video.HAVE_NOTHING) {
        animationFrameRef.current = null;
        return;
      }
      
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationFrameRef.current = requestAnimationFrame(drawFrame);
        return;
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
      } else if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
        // Draw background image first
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
                  console.error('❌ MediaPipe send error:', error);
                }
              });
            } catch (error: any) {
              // Silently handle errors during cleanup or when video is disposed
              if (error.name !== 'InvalidStateError' && !error.message?.includes('no longer, usable')) {
                console.error('❌ MediaPipe send exception:', error);
              }
            }
          }
          
          // Process the latest results from callback (stored in ref)
          const results = latestSegmentationResultsRef.current;
          if (results && results.segmentationMask) {
            // Get segmentation mask (this is a canvas element)
            const mask = results.segmentationMask;
            
            // Create a temporary canvas to draw the person
            const personCanvas = document.createElement('canvas');
            personCanvas.width = canvas.width;
            personCanvas.height = canvas.height;
            const personCtx = personCanvas.getContext('2d');
            
            if (personCtx) {
              // Draw video to temporary canvas
              personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
              
              // Apply mask to keep only the person
              // destination-in: keeps existing content where mask is opaque
              personCtx.globalCompositeOperation = 'destination-in';
              personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
              
              // Now composite: background is already drawn, draw person on top
              ctx.globalCompositeOperation = 'source-over';
              ctx.drawImage(personCanvas, 0, 0);
            } else {
              console.error('❌ Failed to create person canvas context');
              // Fallback if can't create context
              ctx.globalCompositeOperation = 'source-over';
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
          } else {
            // Results not ready yet, draw video for now (will update when results arrive)
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
        } else {
          // No segmentation available - draw video on top (fallback)
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
    drawFrame();
    canvasRef.current = canvas;
    videoElementRef.current = video;

    // Wait a bit to ensure video is playing and canvas is drawing
    await new Promise(resolve => setTimeout(resolve, 200));
    
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
    processedStream.getVideoTracks().forEach(track => {
      track.enabled = true;
      console.log('🎥 Canvas video track:', { id: track.id, enabled: track.enabled, readyState: track.readyState, settings: track.getSettings() });
    });

    console.log('✅ Processed stream created with', processedStream.getVideoTracks().length, 'video tracks and', processedStream.getAudioTracks().length, 'audio tracks');
    console.log('📊 Processed stream video track details:', processedStream.getVideoTracks().map(t => ({ id: t.id, kind: t.kind, enabled: t.enabled, readyState: t.readyState })));
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
      let streamToUse = stream;
      if (type === 'video' && selectedBackground !== 'none') {
        try {
          console.log('🎨 Initiating background processing for video call, background:', selectedBackground);
          streamToUse = await processVideoWithBackground(stream, selectedBackground);
          processedStreamRef.current = streamToUse;
          console.log('✅ Background processing complete, processed stream has', streamToUse.getVideoTracks().length, 'video tracks');
        } catch (error) {
          console.error('❌ Failed to process video with background, using original stream:', error);
          streamToUse = stream; // Fallback to original stream
          processedStreamRef.current = null;
        }
      } else {
        console.log('⏭️ No background processing needed (type:', type, ', background:', selectedBackground, ')');
        processedStreamRef.current = null;
      }
      
      const initialCameraOff = type === 'audio';
      setIsCameraOff(initialCameraOff);
      streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      // Set local peer but keep state as 'calling' until receiver accepts
      setPeers(new Map([[currentUser.id, { id: currentUser.id, stream: streamToUse, isLocal: true, user: currentUser }]]));
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
          let streamToUse = stream;
          if (incomingMode === 'video' && selectedBackground !== 'none') {
            try {
              console.log('🎨 Auto-join: Initiating background processing, background:', selectedBackground);
              streamToUse = await processVideoWithBackground(stream, selectedBackground);
              processedStreamRef.current = streamToUse;
              console.log('✅ Auto-join: Background processing complete');
            } catch (error) {
              console.error('❌ Auto-join: Failed to process video with background, using original stream:', error);
              streamToUse = stream; // Fallback to original stream
              processedStreamRef.current = null;
            }
          } else {
            console.log('⏭️ Auto-join: No background processing needed');
            processedStreamRef.current = null;
          }
          
          const initialCameraOff = incomingMode === 'audio';
          setIsCameraOff(initialCameraOff);
          streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
          
          // Set local peer but keep state as 'calling' until receiver accepts (for receiver, this is fine)
          setPeers(new Map([[currentUser.id, { id: currentUser.id, stream: streamToUse, isLocal: true, user: currentUser }]]));
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
      let streamToUse = stream;
      if (callType === 'video' && selectedBackground !== 'none') {
        try {
          console.log('🎨 Join call: Initiating background processing, background:', selectedBackground);
          streamToUse = await processVideoWithBackground(stream, selectedBackground);
          processedStreamRef.current = streamToUse;
          console.log('✅ Join call: Background processing complete');
        } catch (error) {
          console.error('❌ Join call: Failed to process video with background, using original stream:', error);
          streamToUse = stream; // Fallback to original stream
          processedStreamRef.current = null;
        }
      } else {
        console.log('⏭️ Join call: No background processing needed');
        processedStreamRef.current = null;
      }
      
      const initialCameraOff = callType === 'audio';
      setIsCameraOff(initialCameraOff);
      streamToUse.getVideoTracks().forEach(track => track.enabled = !initialCameraOff);
      
      setPeers(new Map([[currentUser.id, { id: currentUser.id, stream: streamToUse, isLocal: true, user: currentUser }]]));
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
    setSelectedBackground(backgroundId);
    if (callType === 'video' && localStream.current && (callState === 'active' || callState === 'calling')) {
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
      await new Promise(resolve => setTimeout(resolve, 100));

      // Process with new background
      if (backgroundId !== 'none') {
        console.log('🎨 [BACKGROUND CHANGE] Processing with new background:', backgroundId);
        try {
          const newProcessedStream = await processVideoWithBackground(localStream.current, backgroundId);
          processedStreamRef.current = newProcessedStream;
          console.log('✅ [BACKGROUND CHANGE] New processed stream created with', newProcessedStream.getVideoTracks().length, 'video tracks');
        
          // Update local peer
          setPeers(prev => {
            const newPeers = new Map(prev);
            const localPeer = newPeers.get(currentUser.id);
            if (localPeer) {
              newPeers.set(currentUser.id, { ...localPeer, stream: newProcessedStream });
            }
            return newPeers;
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
      <div className="border-b border-gray-800 p-3 bg-gray-900 shrink-0" style={{ position: 'relative', zIndex: 1, minHeight: '80px' }}>
        <div className="flex flex-col gap-3">
          {/* Background Selection (only show for video calls when active) */}
          {callType === 'video' && (callState === 'active' || callState === 'calling') && (
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-sm">Video Background:</span>
              <div className="relative" ref={backgroundSelectorRef}>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowBackgroundSelector(!showBackgroundSelector);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm text-white border-2 transition-colors ${
                    selectedBackground !== 'none' 
                      ? 'border-blue-500 bg-blue-600 hover:bg-blue-500' 
                      : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {getBackgroundById(selectedBackground)?.name || 'None'}
                  <span className="ml-2">▼</span>
                </button>
                {showBackgroundSelector && (
                  <>
                    {/* Backdrop for mobile */}
                    <div 
                      className="fixed inset-0 bg-black bg-opacity-50 z-[99999] sm:hidden"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowBackgroundSelector(false);
                      }}
                      style={{ zIndex: 99999 }}
                    />
                    <div 
                      className="fixed sm:absolute sm:top-full sm:right-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0 mt-0 sm:mt-2 bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-2xl z-[100000] w-[90vw] max-w-[400px] max-h-[80vh] overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                      style={{ zIndex: 100000 }}
                    >
                    <div className="text-white text-sm font-bold mb-3">
                      <span>Select Background</span>
                      <p className="text-xs text-gray-400 font-normal mt-1">Manage backgrounds in Settings</p>
                    </div>
                    
                    {/* Preview Section */}
                    {previewBackground && (
                      <div className="mb-3 p-2 bg-gray-900 rounded border border-gray-600">
                        <div className="text-xs text-gray-400 mb-2">Preview:</div>
                        <div className="relative aspect-video bg-gray-700 rounded overflow-hidden">
                          {previewBackground === 'blur' ? (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                              Blur Effect
                            </div>
                          ) : previewBackground === 'none' ? (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                              No Background
                            </div>
                          ) : (
                            <img 
                              src={getBackgroundById(previewBackground)?.url || ''} 
                              alt="Preview" 
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2">
                      {getAllBackgrounds().map(bg => (
                        <button
                          key={bg.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await handleBackgroundChange(bg.id);
                            setPreviewBackground(bg.id);
                            if (bg.id === 'none') {
                              setShowBackgroundSelector(false);
                            }
                          }}
                          onMouseEnter={() => setPreviewBackground(bg.id)}
                          className={`w-full p-2 rounded-lg text-xs font-medium text-white border-2 transition-colors ${
                            selectedBackground === bg.id 
                              ? 'border-blue-500 bg-blue-600' 
                              : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                          }`}
                        >
                          {bg.name}
                        </button>
                      ))}
                    </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          
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
    <div className="border-b border-gray-800 p-3 bg-gray-900 relative shrink-0" style={{ position: 'relative', zIndex: 1, minHeight: '80px', maxHeight: '500px', overflowY: 'auto' }}>
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-gray-800 p-2 rounded-lg border border-gray-700 shadow-lg relative">
            <span className="text-green-400 text-sm font-bold flex items-center gap-2 px-2">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>
              {callState === 'calling' ? 'Connecting...' : 'Live'}
            </span>
            <div className="flex items-center gap-2 relative">
              <button onClick={toggleMic} className={`p-2 rounded-full text-white ${isMicMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}</button>
              {callType === 'video' && <button onClick={toggleCamera} className={`p-2 rounded-full text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>{isCameraOff ? <VideoOff size={20} /> : <VideoIcon size={20} />}</button>}
              {callType === 'video' && (
                <div className="relative z-50" ref={backgroundSelectorRef}>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowBackgroundSelector(!showBackgroundSelector);
                    }}
                    className={`p-2 rounded-full text-white ${selectedBackground !== 'none' ? 'bg-blue-500' : 'bg-gray-600 hover:bg-gray-500'}`}
                    title="Change Background"
                  >
                    <ImageIcon size={20} />
                  </button>
                  {showBackgroundSelector && (
                    <>
                      {/* Backdrop for mobile */}
                      <div 
                        className="fixed inset-0 bg-black bg-opacity-50 z-[99999] sm:hidden"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowBackgroundSelector(false);
                        }}
                        style={{ zIndex: 99999 }}
                      />
                      <div 
                        className="fixed sm:absolute sm:top-full sm:right-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0 mt-0 sm:mt-2 bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-2xl z-[100000] w-[90vw] max-w-[400px] max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                        style={{ zIndex: 100000 }}
                      >
                      <div className="text-white text-sm font-bold mb-3">
                        <span>Select Background</span>
                        <p className="text-xs text-gray-400 font-normal mt-1">Manage backgrounds in Settings</p>
                      </div>
                      
                      {/* Preview Section */}
                      {previewBackground && (
                        <div className="mb-3 p-2 bg-gray-900 rounded border border-gray-600">
                          <div className="text-xs text-gray-400 mb-2">Preview:</div>
                          <div className="relative aspect-video bg-gray-700 rounded overflow-hidden">
                            {previewBackground === 'blur' ? (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                Blur Effect
                              </div>
                            ) : previewBackground === 'none' ? (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                No Background
                              </div>
                            ) : (
                              <img 
                                src={getBackgroundById(previewBackground)?.url || ''} 
                                alt="Preview" 
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-2">
                        {getAllBackgrounds().map(bg => (
                          <button
                            key={bg.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleBackgroundChange(bg.id);
                              setPreviewBackground(bg.id);
                              if (bg.id === 'none') {
                                setShowBackgroundSelector(false);
                              }
                            }}
                            onMouseEnter={() => setPreviewBackground(bg.id)}
                            className={`w-full p-2 rounded-lg text-xs font-medium text-white border-2 transition-colors ${
                              selectedBackground === bg.id 
                                ? 'border-blue-500 bg-blue-600' 
                                : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                            }`}
                          >
                            {bg.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                  )}
                </div>
              )}
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

