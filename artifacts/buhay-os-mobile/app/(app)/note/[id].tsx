import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { ActionButton, Field, Screen } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';

export default function NoteDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const planner = usePlanner();
  const note = useMemo(() => planner.data.notes.find((item) => item.id === id), [id, planner.data.notes]);
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [message, setMessage] = useState('');

  if (!note) {
    return (
      <Screen title="Note not found" subtitle="This note may have been removed on another device.">
        <ActionButton label="Back to notes" icon="arrow-left" variant="quiet" onPress={() => router.back()} />
      </Screen>
    );
  }

  const save = () => {
    if (!title.trim()) {
      setMessage('Add a title before saving.');
      return;
    }
    planner.saveNote({
      title: title.trim(),
      content,
      date: note.date,
      tags: note.tags,
    }, note.id);
    router.back();
  };

  const remove = () => {
    Alert.alert('Delete note?', 'This removes the note from your planner.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { planner.deleteNote(note.id); router.back(); } },
    ]);
  };

  return (
    <Screen
      eyebrow={note.date || 'Planner note'}
      title="Your note"
      subtitle="Edits sync with the same encrypted planner used on the web."
      headerRight={
        <Pressable accessibilityRole="button" accessibilityLabel="Close note" onPress={() => router.back()} style={styles.close}>
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
      }
    >
      <Field label="Title" value={title} onChangeText={setTitle} testID="note-title" />
      <Field label="Note" value={content} onChangeText={setContent} multiline placeholder="Write your note" testID="note-content" />
      {note.tags.length ? (
        <Text style={[styles.tags, { color: colors.mutedForeground }]}>Tags: {note.tags.map((tag) => `#${tag}`).join('  ')}</Text>
      ) : null}
      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.destructive }]}>{message}</Text> : null}
      <ActionButton label="Save changes" icon="check" onPress={save} disabled={planner.isReadOnly} testID="note-save" />
      <ActionButton label="Delete note" icon="trash-2" variant="danger" onPress={remove} disabled={planner.isReadOnly} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tags: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  message: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
});
