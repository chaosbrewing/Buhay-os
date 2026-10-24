import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState, Pill, Screen, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { searchPlannerRecords, type PlannerSearchFilter } from '@workspace/planner-contract/release2';

export default function SearchScreen() {
  const colors = useColors();
  const planner = usePlanner();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlannerSearchFilter>('all');
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () => normalized ? searchPlannerRecords(planner.data, normalized, filter) : [],
    [normalized, filter, planner.data],
  );
  const filters: PlannerSearchFilter[] = ['all', 'task', 'note', 'project', 'inbox', 'habit', 'routine', 'goal', 'milestone', 'lifeArea', 'review'];
  const openRecord = (ref: (typeof results)[number]['ref']) => {
    if (ref.type === 'task') {
      router.push({ pathname: '/(app)/capture', params: { type: 'task', id: ref.id } });
    } else if (ref.type === 'note') {
      router.push({ pathname: '/(app)/note/[id]', params: { id: ref.id } });
    } else {
      router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: ref.type, id: ref.id } });
    }
  };

  return (
    <Screen
      eyebrow="Search your planner"
      title="Find anything"
      subtitle="Search supported modules in the unlocked planner snapshot. Search stays on this device."
    >
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.input }]}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          accessibilityLabel="Search all supported planner records"
          testID="planner-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Try a title, detail, tag, or date"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.foreground }]}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}>
            <Feather name="x" size={17} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityLabel="Filter search results">
        {filters.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${item === 'all' ? 'all record types' : item}`}
            accessibilityState={{ selected: filter === item }}
            onPress={() => setFilter(item)}
            style={[styles.filter, { backgroundColor: filter === item ? colors.primary : colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.filterText, { color: filter === item ? colors.primaryForeground : colors.mutedForeground }]}>
              {item === 'all' ? 'All' : item === 'lifeArea' ? 'Life area' : item[0].toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {!normalized ? (
        <EmptyState
          icon="search"
          title="Search your planner"
          description="Results stay local to this unlocked snapshot. Handwriting and PDF text are not indexed; Google Calendar events are not searched."
        />
      ) : results.length ? (
        <View style={styles.results}>
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{results.length} results</Text>
          {results.map((result) => (
            <Pressable
              key={`${result.ref.type}-${result.ref.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${result.ref.type}: ${result.title}`}
              onPress={() => openRecord(result.ref)}
            >
              <Surface style={styles.result}>
                <View style={[styles.resultIcon, { backgroundColor: colors.accent }]}>
                  <Feather name={result.ref.type === 'task' || result.ref.type === 'habit' ? 'check-square' : result.ref.type === 'note' || result.ref.type === 'review' ? 'file-text' : 'link'} size={16} color={colors.primary} />
                </View>
                <View style={styles.resultCopy}>
                  <Text numberOfLines={1} style={[styles.resultTitle, { color: colors.foreground }]}>{result.title}</Text>
                  <Text numberOfLines={1} style={[styles.resultDetail, { color: colors.mutedForeground }]}>{result.detail || result.ref.type}</Text>
                </View>
                <Pill label={result.ref.type === 'lifeArea' ? 'Area' : result.ref.type} />
              </Surface>
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="search"
          title="No matches yet"
          description="Try a shorter phrase, or choose a different record type."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBox: { minHeight: 50, borderWidth: 1, borderRadius: 15, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, paddingVertical: 12, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  results: { gap: 10 },
  filters: { gap: 7, paddingVertical: 2 },
  filter: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderRadius: 99 },
  filterText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  count: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 },
  resultIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultCopy: { flex: 1, gap: 3 },
  resultTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
  resultDetail: { fontFamily: 'DMSans_400Regular', fontSize: 11 },
});
