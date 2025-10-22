# Meyda Audio Analysis Integration

This document explains the Meyda audio analysis integration implemented in the heart animation application.

## Overview

The Meyda JavaScript library has been integrated to provide real-time audio feature extraction for enhanced heart animation reactivity. This integration replaces the previous ReccoBeats implementation and provides more sophisticated audio analysis capabilities.

## Implementation Details

### 1. Service Layer (`src/services/meyda.ts`)

The `MeydaAudioService` class provides:
- **Real-time Audio Analysis**: Extracts comprehensive audio features using Meyda
- **Web Audio API Integration**: Seamlessly works with browser audio contexts
- **Feature Normalization**: Normalizes all audio features to 0-1 range for consistent usage
- **Caching**: 2-minute cache duration for performance optimization
- **Rate Limiting**: 100ms delay between analysis cycles to prevent performance issues

### 2. Audio Features Extracted

The service extracts the following Meyda audio features:

#### Time-Domain Features
- **RMS (Root Mean Square)**: Overall loudness/energy of the audio signal
- **Energy**: Another indicator of signal loudness
- **ZCR (Zero Crossing Rate)**: Helps differentiate between percussive and pitched sounds

#### Spectral Features
- **Spectral Centroid**: "Brightness" of the sound (higher = brighter)
- **Spectral Rolloff**: Frequency below which 99% of energy is contained
- **Spectral Flux**: How quickly the spectrum is changing (beat detection)
- **Spectral Spread**: How spread out the frequency content is
- **Spectral Kurtosis**: "Pointiness" of the spectrum (tonality indicator)

#### Perceptual Features
- **Loudness**: Human-perceived loudness using Bark scale
- **MFCC (Mel-Frequency Cepstral Coefficients)**: 13 coefficients for timbral analysis
- **Chroma**: 12 pitch classes (C, C#, D, etc.) for harmonic content

### 3. Heart Animation Integration

The heart animation now uses Meyda features for:

#### Heart Pulsing
- **RMS**: Controls base heart size (loudness = larger heart)
- **Spectral Centroid**: Influences heart brightness/color intensity
- **Spectral Flux**: Enhanced beat detection for heart beats
- **Loudness**: Overall intensity multiplier

#### Heart Color
- **Chroma**: Musical key-based coloring (12 different colors)
- **Spectral Rolloff**: Color saturation control
- **MFCC**: Nuanced color variations based on timbre

#### Particle Movement
- **Spectral Spread**: Controls particle speed variation
- **Spectral Kurtosis**: Influences particle trail effects
- **Spectral Flux**: Particle direction changes on beats

### 4. Context Management

The `AudioVisualizerContext` has been updated to:
- Store Meyda audio features globally
- Provide real-time audio data to the heart animation
- Manage state across the application
- Replace ReccoBeats data structure

## Usage Examples

### Basic Usage
```typescript
import { meydaAudioService } from '../services/meyda';

// Initialize with audio element
await meydaAudioService.initializeAudioContext(audioElement);

// Start analysis with callback
meydaAudioService.startAnalysis((features) => {
  console.log('RMS:', features.rms);
  console.log('Spectral Centroid:', features.spectralCentroid);
  console.log('Chroma:', features.chroma);
});
```

### Feature Mapping
```typescript
// Heart size based on loudness
const heartSize = 1 + (features.rms * 0.5);

// Color based on chroma (musical key)
const dominantPitch = features.chroma.indexOf(Math.max(...features.chroma));
const color = `hsl(${dominantPitch * 30}, 70%, 60%)`;

// Beat detection using spectral flux
const isBeat = features.spectralFlux > 0.3;
```

## Performance Considerations

### Optimization Features
1. **Rate Limiting**: 100ms minimum delay between analysis cycles
2. **Caching**: 2-minute cache for repeated audio segments
3. **Feature Normalization**: All features normalized to 0-1 range
4. **Single Analyzer**: Prevents multiple analyzer conflicts

### Resource Usage
- **CPU**: Moderate usage due to FFT calculations
- **Memory**: Minimal memory footprint
- **Browser Compatibility**: Works with all modern browsers supporting Web Audio API

## Visual Indicators

The application includes visual indicators:
- **Red Dot**: Loading audio analysis
- **Green Dot**: Meyda real-time analysis active
- **Orange Dot**: Enhanced simulation (fallback)
- **Purple Dot**: Local audio file analysis

## Integration with Spotify

### Spotify Track Analysis
1. **Real-time Processing**: Meyda analyzes the actual audio being played
2. **Feature Extraction**: Comprehensive audio features extracted in real-time
3. **Heart Reactivity**: Heart animation responds to actual audio characteristics
4. **Musical Intelligence**: Chroma and MFCC provide musical context

### Fallback Behavior
- **Spotify Features**: Uses Spotify track data when Meyda unavailable
- **Enhanced Simulation**: Time-based simulation with audio feature multipliers
- **Graceful Degradation**: Maintains functionality even without real-time analysis

## Troubleshooting

### Common Issues

1. **Audio Context Suspended**: User interaction required to resume audio context
2. **CORS Issues**: Ensure audio sources are accessible
3. **Performance**: Reduce analysis frequency if experiencing lag
4. **Browser Compatibility**: Requires Web Audio API support

### Debug Information

Enable debug logging:
```typescript
// Check cache statistics
console.log(meydaAudioService.getCacheStats());

// Monitor audio features
meydaAudioService.startAnalysis((features) => {
  console.log('Audio Features:', features);
});
```

## Future Enhancements

1. **Machine Learning**: Use MFCC features for genre classification
2. **Advanced Beat Detection**: Combine multiple features for better beat detection
3. **Musical Analysis**: Use chroma for chord progression visualization
4. **Performance Optimization**: Web Workers for heavy computation

## Comparison with Previous Implementation

### ReccoBeats vs Meyda

| Feature | ReccoBeats | Meyda |
|---------|------------|-------|
| **Real-time Analysis** | ❌ API-based | ✅ Browser-based |
| **Audio Features** | Limited | Comprehensive |
| **Musical Intelligence** | Basic | Advanced (Chroma, MFCC) |
| **Performance** | Network dependent | Local processing |
| **Reliability** | API dependent | Self-contained |

### Benefits of Meyda Integration

1. **Real-time Processing**: No network latency
2. **Comprehensive Features**: 9+ audio features vs 3-4 from APIs
3. **Musical Intelligence**: Chroma and MFCC for musical analysis
4. **Reliability**: No external API dependencies
5. **Performance**: Local processing with caching
6. **Privacy**: No data sent to external services

## Security Considerations

- **No External APIs**: All processing happens locally
- **No Data Transmission**: Audio analysis stays in browser
- **Privacy**: No audio data leaves the user's device
- **CORS**: No cross-origin requests required

## Monitoring

The application includes comprehensive monitoring:
- **Feature Extraction**: Real-time audio feature logging
- **Performance Metrics**: Analysis timing and cache statistics
- **Error Handling**: Graceful fallback on analysis failures
- **Visual Feedback**: Status indicators for analysis state
