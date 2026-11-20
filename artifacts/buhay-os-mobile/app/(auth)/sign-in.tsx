import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ActionButton, Field } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'sign-in' | 'sign-up' | 'verify-sign-in' | 'verify-sign-up';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const goToPlanner = () => router.replace('/(app)/(tabs)');

  const continueWithGoogle = async () => {
    setPending(true);
    setMessage('');
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'buhay-os-mobile' }),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        goToPlanner();
      } else {
        setMessage('Google sign-in needs another verification step. Try email sign-in or finish on the web planner.');
      }
    } catch {
      setMessage('Google sign-in could not finish. Check the connection or continue with email.');
    } finally {
      setPending(false);
    }
  };

  const submitCredentials = async () => {
    Keyboard.dismiss();
    setPending(true);
    setMessage('');
    try {
      if (mode === 'sign-in') {
        const { error } = await signIn.password({ emailAddress: email.trim(), password });
        if (error) {
          setMessage('Those account details could not be verified. Check them and try again.');
        } else if (signIn.status === 'complete') {
          await signIn.finalize({ navigate: () => goToPlanner() });
        } else if (
          signIn.status === 'needs_client_trust' ||
          signIn.status === 'needs_second_factor'
        ) {
          const emailFactor = signIn.supportedSecondFactors?.find(
            (factor) => factor.strategy === 'email_code',
          );
          if (emailFactor) {
            await signIn.mfa.sendEmailCode();
            setMode('verify-sign-in');
          } else {
            setMessage('This account needs an additional verification method not supported in the mobile companion yet. Sign in on the web planner.');
          }
        } else {
          setMessage('This account needs another setup step. Please finish signing in on the web planner.');
        }
      } else {
        const { error } = await signUp.password({
          emailAddress: email.trim(),
          password,
        });
        if (error) {
          setMessage('The account could not be created with those details. Check the email and password.');
        } else {
          const { error: codeError } = await signUp.verifications.sendEmailCode();
          if (codeError) {
            setMessage('The verification email could not be sent. Try again in a moment.');
          } else {
            setMode('verify-sign-up');
            setMessage('A verification code was sent to your email.');
          }
        }
      }
    } catch {
      setMessage('Sign-in could not be completed. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async () => {
    Keyboard.dismiss();
    setPending(true);
    setMessage('');
    try {
      if (mode === 'verify-sign-up') {
        const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (error) {
          setMessage('That verification code could not be accepted. Check it and try again.');
        } else if (signUp.status === 'complete') {
          await signUp.finalize({ navigate: () => goToPlanner() });
        } else {
          setMessage('More account setup is required. Finish it in the web planner.');
        }
      } else {
        const { error } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
        if (error) {
          setMessage('That verification code could not be accepted. Check it and try again.');
        } else if (signIn.status === 'complete') {
          await signIn.finalize({ navigate: () => goToPlanner() });
        } else {
          setMessage('More account verification is required. Finish it in the web planner.');
        }
      }
    } catch {
      setMessage('Verification could not be completed. Request a fresh code and try again.');
    } finally {
      setPending(false);
    }
  };

  const isVerifying = mode === 'verify-sign-in' || mode === 'verify-sign-up';
  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      <KeyboardAwareScrollViewCompat
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 18) },
        ]}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Image
            source={require('../../assets/images/wordmark.png')}
            resizeMode="contain"
            accessibilityLabel="HANAY"
            style={styles.logo}
          />
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>YOUR LIFE, IN ORBIT</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {isVerifying
              ? 'Check your email'
              : mode === 'sign-up'
                ? 'Create your account'
                : 'Welcome back'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {isVerifying
              ? 'Enter the one-time code. Your planner encryption passphrase is separate.'
              : 'Sign in to your existing HANAY account to sync your planner across devices.'}
          </Text>

          {isVerifying ? (
            <>
              <Field
                label="Verification code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                placeholder="Enter the code from your email"
                testID="auth-verification-code"
              />
              <ActionButton
                label="Verify and continue"
                icon="arrow-right"
                onPress={() => void verifyCode()}
                disabled={pending || code.trim().length < 4}
                testID="auth-verify"
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setCode('');
                  setMode(mode === 'verify-sign-up' ? 'sign-up' : 'sign-in');
                  setMessage('');
                }}
                style={styles.textButton}
              >
                <Text style={[styles.linkText, { color: colors.primary }]}>Back to account details</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Field
                label="Email address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                placeholder="you@example.com"
                testID="auth-email"
              />
              <Field
                label="Account password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
                placeholder="Enter your account password"
                testID="auth-password"
              />
              <ActionButton
                label={mode === 'sign-up' ? 'Create account' : 'Sign in'}
                icon="arrow-right"
                onPress={() => void submitCredentials()}
                disabled={pending || !email.trim() || !password}
                testID="auth-submit"
              />
              <View nativeID="clerk-captcha" />
              <View style={styles.dividerRow}>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Text style={[styles.orText, { color: colors.mutedForeground }]}>OR</Text>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>
              <ActionButton
                label="Continue with Google"
                icon="globe"
                variant="quiet"
                onPress={() => void continueWithGoogle()}
                disabled={pending}
                testID="auth-google"
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
                  setMessage('');
                }}
                style={styles.textButton}
              >
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  {mode === 'sign-up' ? 'Already have an account? Sign in' : 'New to HANAY? Create an account'}
                </Text>
              </Pressable>
            </>
          )}

          {pending ? (
            <ActivityIndicator accessibilityLabel="Working" color={colors.primary} />
          ) : null}
          {message ? (
            <Text accessibilityRole="alert" style={[styles.message, { color: colors.mutedForeground }]}>
              {message}
            </Text>
          ) : null}
          <Text style={[styles.privacy, { color: colors.mutedForeground }]}>
            Your account password signs you in. A separate encryption passphrase protects planner contents.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28 },
  card: { width: '100%', maxWidth: 430, alignSelf: 'center', borderWidth: 1, borderRadius: 24, padding: 24, gap: 16 },
  logo: { width: 174, height: 40, alignSelf: 'center', marginBottom: 4 },
  eyebrow: { fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.7, textAlign: 'center' },
  title: { fontFamily: 'Fraunces_500Medium', fontSize: 30, textAlign: 'center' },
  subtitle: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
  textButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', padding: 6 },
  linkText: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, textAlign: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { height: 1, flex: 1 },
  orText: { fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1 },
  message: { fontFamily: 'DMSans_500Medium', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  privacy: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 2 },
});
