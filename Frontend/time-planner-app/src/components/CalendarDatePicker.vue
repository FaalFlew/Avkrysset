<!-- MODIFIED FILE: src/components/CalendarDatePicker.vue -->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useUIStore } from "@/stores/uiStore";
import { storeToRefs } from "pinia";
import dayjs from "dayjs";
import isoWeeksInYear from "dayjs/plugin/isoWeeksInYear"; // To get total weeks in a year
import isoWeek from "dayjs/plugin/isoWeek"; // To get/set ISO week number
import isLeapYear from "dayjs/plugin/isLeapYear";

dayjs.extend(isoWeek);
dayjs.extend(isLeapYear); // <-- important
dayjs.extend(isoWeeksInYear);

const uiStore = useUIStore();
const { currentDate } = storeToRefs(uiStore);

// View can be 'weeks' or 'years'
const currentView = ref<"weeks" | "years">("weeks");
// Primary date controlling the view
const viewDate = ref(dayjs(currentDate.value));

// --- Computed Properties ---
const currentYear = computed(() => viewDate.value.year());

// Generate the grid of weeks for the selected year
const weeksInYearGrid = computed(() => {
  const year = viewDate.value.year();
  const totalWeeks = dayjs().year(year).isoWeeksInYear();

  // THIS IS THE FIX FOR WEEK SELECTION:
  // We must compare the viewDate's year with the currentDate's year.
  // The blue background should only appear if the selected week is in the currently displayed year.
  const selectedWeek =
    dayjs(currentDate.value).year() === year
      ? dayjs(currentDate.value).isoWeek()
      : -1; // If not in this year, no week is selected.

  const todayWeek = dayjs().year() === year ? dayjs().isoWeek() : -1;

  const grid = [];
  for (let i = 1; i <= totalWeeks; i++) {
    grid.push({
      weekNumber: i,
      isSelected: i === selectedWeek,
      isCurrent: i === todayWeek,
    });
  }
  return grid;
});

// Generate a 12-year grid centered around current view year
const yearGrid = computed(() => {
  const startYear = viewDate.value.year() - 6;
  return Array.from({ length: 12 }, (_, i) => startYear + i);
});

// --- Navigation Methods ---
const goToPrevious = () => {
  if (currentView.value === "weeks") {
    viewDate.value = viewDate.value.subtract(1, "year");
  } else {
    viewDate.value = viewDate.value.subtract(12, "years");
  }
};

const goToNext = () => {
  if (currentView.value === "weeks") {
    viewDate.value = viewDate.value.add(1, "year");
  } else {
    viewDate.value = viewDate.value.add(12, "years");
  }
};
watch(currentDate, (newGlobalDate) => {
  // When the "Today" button (or anything else) changes the global date,
  // update the picker's internal view to match.
  viewDate.value = dayjs(newGlobalDate);
});

// Update global state when a week is selected
const selectWeek = (weekNumber: number) => {
  // Start at the first week of the selected year to avoid month/day inconsistencies
  const newDate = dayjs()
    .year(viewDate.value.year())
    .startOf("year")
    .isoWeek(weekNumber);
  currentDate.value = newDate.toISOString();
  viewDate.value = newDate;
};

// --- View Switching ---
const toggleView = () => {
  currentView.value = currentView.value === "weeks" ? "years" : "weeks";
};

const selectYear = (year: number) => {
  viewDate.value = viewDate.value.year(year);
  currentView.value = "weeks";
};
</script>

<template>
  <div class="week-picker">
    <div class="header">
      <button @click="goToPrevious" class="nav-arrow">&lt;</button>
      <!-- MODIFICATION: The title is now just the year and is clickable -->
      <div class="title-container" @click="toggleView">
        <span class="year-name">{{ currentYear }}</span>
      </div>
      <button @click="goToNext" class="nav-arrow">&gt;</button>
    </div>

    <!-- Weeks View -->
    <div v-if="currentView === 'weeks'" class="view-container">
      <div class="weeks-grid">
        <button
          v-for="week in weeksInYearGrid"
          :key="week.weekNumber"
          @click="selectWeek(week.weekNumber)"
          :class="{
            'is-current-week': week.isCurrent,
            'is-selected-week': week.isSelected,
          }"
        >
          {{ week.weekNumber }}
        </button>
      </div>
    </div>

    <!-- Year View (remains the same) -->
    <div v-if="currentView === 'years'" class="view-container">
      <div class="years-grid">
        <button
          v-for="year in yearGrid"
          :key="year"
          @click="selectYear(year)"
          :class="{ 'is-selected-year': year === dayjs(currentDate).year() }"
        >
          {{ year }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- OVERHAULED STYLES for the Week Picker --- */
.week-picker {
  width: 100%;
  padding: 0.5rem;
  background: #fff;
  border-radius: 4px;
  font-size: 0.8rem; /* Smaller base font size */
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-weight: 500;
}
.nav-arrow {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.4rem;
  border-radius: 4px;
}
.nav-arrow:hover {
  background-color: #f0f0f0;
}
.title-container {
  cursor: pointer;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-weight: 600;
}
.title-container:hover {
  background-color: #f0f0f0;
}

.view-container {
  transition: opacity 0.2s ease-in-out;
}

/* New grid for weeks */
.weeks-grid {
  display: grid;
  /* A 6-column grid is perfect for 52/53 weeks */
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}

.weeks-grid button {
  border: 1px solid transparent;
  background: #f9f9f9;
  padding: 0.2rem 0; /* Make buttons shorter */
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.75rem; /* Smaller week numbers */
  transition: all 0.2s;
}
.weeks-grid button:hover {
  background-color: #e9e9e9;
  border-color: #ccc;
}

/* --- THE FIX IS HERE --- */
/* MODIFICATION: Increase the specificity of the selector */
.weeks-grid button.is-selected-week {
  background-color: var(--primary-color);
  color: white; /* Let's change this back to white for better contrast */
  border-color: var(--primary-color);
  font-weight: bold;
}
/* Let's also fix the hover state for the selected week */
.weeks-grid button.is-selected-week:hover {
  background-color: var(--primary-color);
  filter: brightness(1.1);
}

/* Let's also fix the specificity for the current week border for good measure */
.weeks-grid button.is-current-week {
  border-color: var(--primary-color);
  font-weight: bold;
}

/* Year view styles remain the same but can be tweaked for consistency */
.years-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  padding: 0.5rem 0;
}
.years-grid button {
  border: none;
  background-color: #f9f9f9;
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
}
.years-grid button:hover {
  background-color: #e0e0e0;
}
.years-grid button.is-selected-year {
  background-color: var(--primary-color);
  color: white;
  font-weight: bold;
}
</style>
