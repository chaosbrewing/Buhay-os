import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';

export default function IndexRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const colors = useColors();
  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Redirect
      href={isSignedIn ? '/(app)/(tabs)' : '/(auth)/sign-in'}
    />
  );
}
