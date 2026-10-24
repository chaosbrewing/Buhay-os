import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Screen, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';

export default function NotesScreen() {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const notes = [...planner.data.notes].sort((left, right) => right.date.localeCompare(left.date));
  return (
    <Screen
      eyebrow="Your notebook"
      title="Notes"
      subtitle="Ideas and notes sync in the same encrypted planner as the web app."
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a note"
          testID="new-note"
          onPress={() => router.push({ pathname: '/(app)/capture', params: { type: 'note' } })}
          style={[styles.add, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
        </Pressable>
      }
    >
      {notes.length ? (
        <View style={styles.list}>
          {notes.map((note) => (
            <Pressable
              key={note.id}
              accessibilityRole="button"
              accessibilityLabel={`Open note: ${note.title}`}
              onPress={() => router.push({ pathname: '/(app)/note/[id]', params: { id: note.id } })}
            >
              <Surface style={styles.noteCard}>
                <View style={styles.noteHead}>
                  <View style={[styles.noteIcon, { backgroundColor: colors.accent }]}>
                    <Feather name="file-text" size={17} color={colors.primary} />
                  </View>
                  <Text style={[styles.noteDate, { color: colors.mutedForeground }]}>
                    {note.date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${note.date}T12:00:00`)) : 'Undated'}
                  </Text>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </View>
                <Text numberOfLines={1} style={[styles.noteTitle, { color: colors.foreground }]}>{note.title}</Text>
                <Text numberOfLines={3} style={[styles.noteBody, { color: colors.mutedForeground }]}>
                  {note.content || 'No additional text'}
                </Text>
                {note.tags.length ? (
                  <View style={styles.tags}>
                    {note.tags.map((tag) => (
                      <Text key={tag} style={[styles.tag, { backgroundColor: colors.muted, color: colors.mutedForeground }]}>#{tag}</Text>
                    ))}
                  </View>
                ) : null}
              </Surface>
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="book-open"
          title="Your notebook is ready"
          description="Capture a thought now. Your notes stay private and searchable after you unlock your planner."
        />
      )}
      {!notes.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Capture your first note"
          onPress={() => router.push({ pathname: '/(app)/capture', params: { type: 'note' } })}
          style={[styles.addWide, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addText, { color: colors.primaryForeground }]}>Capture a note</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  list: { gap: 11 },
  noteCard: { gap: 9, padding: 16 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  noteDate: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  noteTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 20, lineHeight: 26 },
  noteBody: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 3 },
  tag: { overflow: 'hidden', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, fontFamily: 'DMSans_600SemiBold', fontSize: 10 },
  addWide: { minHeight: 44, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  addText: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
});
