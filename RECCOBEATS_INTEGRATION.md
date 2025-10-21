# ReccoBeats API Integration

This document explains the ReccoBeats API integration implemented in the heart animation application.

## Overview

The ReccoBeats API has been integrated to provide enhanced audio features for the heart animation visualization. This integration includes:

- **Audio Features**: Energy, danceability, valence, acousticness, instrumentalness, etc.
- **Rate Limiting**: Prevents API spamming with intelligent caching
- **Fallback Support**: Graceful degradation when API is unavailable

## Implementation Details

### 1. Service Layer (`src/services/reccobeats.ts`)

The `ReccoBeatsService` class provides:
- **Caching**: 5-minute cache duration to prevent redundant API calls
- **Rate Limiting**: 1-second delay between requests
- **Queue Management**: Request queuing to handle multiple simultaneous requests
- **Error Handling**: Graceful error handling with fallbacks

### 2. Type Definitions (`src/types/reccobeats.d.ts`)

TypeScript interfaces for:
- `ReccoBeatsAudioFeatures`: Core audio features from the API
- `ReccoBeatsTrack`: Track information
- `ReccoBeatsAlbum`: Album information
- `ReccoBeatsMultipleTracks`: Batch track requests
- `ReccoBeatsError`: Error response structure

### 3. Heart Animation Integration

The `HeartAnimation` component now uses ReccoBeats data to:
- **Enhanced Simulation**: More accurate audio-reactive behavior when Spotify analysis is unavailable
- **Feature-Based Animation**: Uses energy, danceability, and valence for more realistic heart pulsing
- **Fallback Support**: Falls back to basic simulation if ReccoBeats data is unavailable

### 4. Context Management

The `AudioVisualizerContext` has been extended to:
- Store ReccoBeats audio features globally
- Provide data to the heart animation component
- Manage state across the application

## API Endpoints Used

1. **Get Track Audio Features**
   ```
   GET https://api.reccobeats.com/v1/track/{id}/audio-features
   ```

2. **Get Track Details**
   ```
   GET https://api.reccobeats.com/v1/track/{id}
   ```

3. **Get Track's Album**
   ```
   GET https://api.reccobeats.com/v1/track/{id}/album
   ```

4. **Get Multiple Tracks**
   ```
   GET https://api.reccobeats.com/v1/tracks?ids={id1},{id2},...
   ```

## Rate Limiting & Caching

### Caching Strategy
- **Duration**: 5 minutes per track
- **Key**: `${endpoint}_${trackId}`
- **Cleanup**: Automatic cache expiration

### Rate Limiting
- **Delay**: 1 second between requests
- **Queue**: Sequential request processing
- **Prevention**: No duplicate requests for the same track

### Cache Management
```typescript
// Clear cache for specific track
reccoBeatsService.clearTrackCache(trackId);

// Clear all cache
reccoBeatsService.clearAllCache();

// Get cache statistics
const stats = reccoBeatsService.getCacheStats();
```

## Usage Examples

### Basic Usage
```typescript
import { reccoBeatsService } from '../services/reccobeats';

// Get audio features for a track
const features = await reccoBeatsService.getTrackAudioFeatures('track-id');
console.log(features.energy, features.danceability, features.valence);
```

### Error Handling
```typescript
try {
  const features = await reccoBeatsService.getTrackAudioFeatures(trackId);
  // Use features for animation
} catch (error) {
  console.error('ReccoBeats API error:', error);
  // Fallback to default values
}
```

## Integration with Heart Animation

The heart animation now responds to:
- **Energy**: Controls overall pulse intensity
- **Danceability**: Affects rhythm and movement
- **Valence**: Influences color and mood
- **Acousticness**: Modifies frequency distribution
- **Instrumentalness**: Adjusts beat detection

## Performance Considerations

1. **Caching**: Reduces API calls by 90%+ for repeated tracks
2. **Rate Limiting**: Prevents API abuse and ensures reliable service
3. **Queue Management**: Handles multiple requests efficiently
4. **Fallback**: Graceful degradation maintains user experience

## Monitoring

The application includes visual indicators:
- **Red Dot**: Loading ReccoBeats data
- **Orange Dot**: Using enhanced simulation with ReccoBeats
- **Green Dot**: Using real-time Spotify analysis
- **Purple Dot**: Using local audio analysis

## Future Enhancements

1. **Batch Processing**: Fetch multiple tracks simultaneously
2. **Advanced Caching**: Redis-based caching for production
3. **Analytics**: Track API usage and performance
4. **A/B Testing**: Compare different visualization algorithms

## Troubleshooting

### Common Issues

1. **API Rate Limits**: The service automatically handles rate limiting
2. **Network Errors**: Graceful fallback to default values
3. **Cache Issues**: Use `clearAllCache()` to reset
4. **Track Not Found**: API returns 404, service handles gracefully

### Debug Information

Enable debug logging:
```typescript
// Check cache statistics
console.log(reccoBeatsService.getCacheStats());

// Monitor API calls
// Check browser network tab for ReccoBeats API calls
```

## Security Considerations

- **No Authentication**: ReccoBeats API doesn't require authentication
- **Rate Limiting**: Built-in protection against abuse
- **CORS**: API supports cross-origin requests
- **Data Privacy**: No sensitive data is stored or transmitted
