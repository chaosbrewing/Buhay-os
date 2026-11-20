import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { type ReactNode } from 'react';
import {
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { usePlanner, type SyncStatus } from '@/components/PlannerProvider';
import type { PlannerTask } from '@/lib/planner-data';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export function Screen({
  eyebrow,
  title,
  subtitle,
  children,
  headerRight,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const planner = usePlanner();
  const router = useRouter();
  return (
    <View
      style={[
        styles.page,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === 'web' ? 67 : insets.top,
        },
      ]}
    >
      <KeyboardAwareScrollViewCompat
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.pageContent,
          {
            paddingBottom:
              Platform.OS === 'web' ? 118 : Math.max(insets.bottom, 14) + 24,
          },
        ]}
      >
        <View style={styles.pageInner}>
          <View style={styles.brandBar}>
            <Image
              source={require('../assets/images/wordmark.png')}
              resizeMode="contain"
              accessibilityLabel="Buhay.OS"
              style={styles.wordmark}
            />
            {headerRight ?? (
              <IconButton
                icon="settings"
                label="Open settings"
                onPress={() => {
                  Keyboard.dismiss();
                  router.push('/(app)/settings');
                }}
              />
            )}
          </View>

          <View style={styles.headingBlock}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
                {eyebrow}
              </Text>
            ) : null}
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <SyncIndicator
            status={planner.syncStatus}
            online={planner.isOnline}
            readOnly={planner.isReadOnly}
            notice={planner.syncNotice}
          />
          {children}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  testID,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon?: FeatherName;
  variant?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.destructive
        : colors.card;
  const foreground =
    variant === 'primary'
      ? colors.primaryForeground
      : variant === 'danger'
        ? colors.destructiveForeground
        : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: colors.border },
        variant === 'quiet' && styles.quietButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <Feather name={icon} size={17} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          borderColor: colors.border,
          backgroundColor: colors.card,
        },
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={18} color={colors.foreground} />
    </Pressable>
  );
}

export function Field({
  label,
  multiline,
  ...props
}: TextInputProps & { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        multiline={multiline}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.field,
          {
            backgroundColor: colors.card,
            borderColor: colors.input,
            color: colors.foreground,
          },
          multiline && styles.multilineField,
          props.style,
        ]}
      />
    </View>
  );
}

export function Surface({ children, style, testID }: { children: ReactNode; style?: object; testID?: string }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export function Pill({
  label,
  selected,
  onPress,
  icon,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: FeatherName;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const content = (
    <>
      {icon ? (
        <Feather
          name={icon}
          size={14}
          color={selected ? colors.primaryForeground : colors.mutedForeground}
        />
      ) : null}
      <Text
        style={[
          styles.pillText,
          { color: selected ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </>
  );
  const style = [
    styles.pill,
    {
      backgroundColor: selected ? colors.primary : colors.card,
      borderColor: selected ? colors.primary : colors.border,
    },
  ];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      aria-pressed={Boolean(selected)}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
}: {
  icon?: FeatherName;
  title: string;
  description: string;
}) {
  const colors = useColors();
  return (
    <Surface style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>
        {description}
      </Text>
    </Surface>
  );
}

export function TaskRow({
  task,
  onToggle,
  onOpen,
}: {
  task: PlannerTask;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <Surface style={styles.taskRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${task.completed ? 'Mark incomplete' : 'Complete'}: ${task.title}`}
        accessibilityState={{ checked: task.completed }}
        testID={`task-toggle-${task.id}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.check,
          {
            borderColor: task.completed ? colors.primary : colors.input,
            backgroundColor: task.completed ? colors.primary : 'transparent',
          },
          pressed && styles.pressed,
        ]}
      >
        {task.completed ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit task: ${task.title}`}
        onPress={onOpen}
        style={styles.taskMain}
      >
        <Text
          numberOfLines={2}
          style={[
            styles.taskTitle,
            { color: task.completed ? colors.mutedForeground : colors.foreground },
            task.completed && styles.completedText,
          ]}
        >
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.dueTime ? (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{task.dueTime}</Text>
          ) : null}
          {task.tag ? <Pill label={task.tag} /> : null}
        </View>
      </Pressable>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Surface>
  );
}

export function SyncIndicator({
  status,
  online,
  readOnly,
  notice,
}: {
  status: SyncStatus;
  online: boolean;
  readOnly: boolean;
  notice: string;
}) {
  const colors = useColors();
  const label = readOnly
    ? 'Read only'
    : status === 'syncing'
      ? 'Syncing'
      : status === 'queued'
        ? 'Changes waiting'
        : status === 'offline' || !online
          ? 'Offline · encrypted'
          : status === 'error' || status === 'conflict'
            ? 'Sync needs attention'
            : status === 'checking'
              ? 'Checking sync'
              : 'Synced';
  const icon: FeatherName = readOnly
    ? 'lock'
    : status === 'syncing'
      ? 'refresh-cw'
      : !online || status === 'offline'
        ? 'cloud-off'
        : status === 'error' || status === 'conflict'
          ? 'alert-circle'
          : 'cloud';
  return (
    <View style={styles.syncBlock}>
      <View
        accessibilityRole="text"
        accessibilityLabel={`Sync status: ${label}`}
        style={[
          styles.syncPill,
          {
            backgroundColor: readOnly ? colors.accent : colors.muted,
            borderColor: colors.border,
          },
        ]}
      >
        <Feather name={icon} size={13} color={readOnly ? colors.accentForeground : colors.mutedForeground} />
        <Text style={[styles.syncText, { color: readOnly ? colors.accentForeground : colors.mutedForeground }]}>
          {label}
        </Text>
      </View>
      {notice ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            { backgroundColor: colors.accent, borderColor: colors.border },
          ]}
        >
          <Feather name="info" size={16} color={colors.accentForeground} />
          <Text style={[styles.noticeText, { color: colors.accentForeground }]}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SectionHeading({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {trailing}
    </View>
  );
}

export function formatDayLabel(dateKey: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, options ?? {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pageContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 12 },
  pageInner: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 18 },
  brandBar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: { width: 152, height: 34 },
  headingBlock: { gap: 6 },
  eyebrow: { fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.7, textTransform: 'uppercase' },
  title: { fontFamily: 'Fraunces_500Medium', fontSize: 34, lineHeight: 40 },
  subtitle: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21 },
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  quietButton: { borderWidth: 1 },
  buttonText: { fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
  },
  fieldGroup: { gap: 7 },
  fieldLabel: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
  field: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  multilineField: { minHeight: 142, textAlignVertical: 'top' },
  surface: { borderWidth: 1, borderRadius: 18, padding: 16 },
  pill: {
    minHeight: 30,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pillText: { fontFamily: 'DMSans_600SemiBold', fontSize: 12 },
  emptyState: { alignItems: 'center', gap: 9, paddingVertical: 28, paddingHorizontal: 20 },
  emptyIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, textAlign: 'center' },
  emptyDescription: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  check: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  taskMain: { flex: 1, minWidth: 0, gap: 5 },
  taskTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, lineHeight: 20 },
  completedText: { textDecorationLine: 'line-through' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  syncBlock: { gap: 8 },
  syncPill: { alignSelf: 'flex-start', minHeight: 27, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  syncText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderWidth: 1, borderRadius: 14 },
  noticeText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  sectionTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 22 },
});
