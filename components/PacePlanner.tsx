"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, RefreshCcw, Clock, MapPinned, Footprints, Route } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SegmentDef = {
  name: string;
  startMile: number;
  endMile: number;
  defaultAdjPct?: number;
};

type ElevationKey = {
  mile: number;
  elev: number;
};

type CourseDef = {
  slug: string;
  name: string;
  distanceMiles: number;
  segments: SegmentDef[];
  elevationKeys: ElevationKey[];
  timingMats: number[];
  defaultCrewMiles: number[];
  defaultStartTime: string;
  defaultGoalPace: string;
  note?: string;
};

type PlannerMode = "pace" | "time";

type SegmentAdjustment = {
  name: string;
  pct: number;
};

type RowData = {
  idx: number;
  mile: number;
  km: number;
  segName?: string;
  pace: string;
  split: string;
  cumulative: string;
  clock: string;
  gel: "" | "Gel";
  water: "" | "Water";
  crew: "" | "Crew";
  mat: "" | "Mat";
  walk: string;
  yPaceSec: number;
};

type ChartPoint = {
  name: number;
  paceSec: number;
  elev: number;
};

type PlannerComputation = {
  rows: RowData[];
  addedWalkTimeSec: number;
  totalWalkDistance: number;
  walkBreakCount: number;
  actualElapsedSec: number;
  baselineElapsedSec: number;
};

type WalkWindow = {
  start: number;
  end: number;
};

const WALK_BREAK_DISTANCE = 0.25;
const KM_PER_MILE = 1.609344;

function pad(n: number, width = 2) {
  const s = String(n);
  return s.length >= width ? s : `${"0".repeat(width - s.length)}${s}`;
}

function hhmmssToSeconds(value: string) {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return Number(value) || 0;
}

function secondsToHMS(total: number) {
  const neg = total < 0;
  const t = Math.max(0, Math.round(Math.abs(total)));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${neg ? "-" : ""}${h}:${pad(m)}:${pad(s)}`;
}

function secondsToMS(total: number) {
  const neg = total < 0;
  const t = Math.max(0, Math.round(Math.abs(total)));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${neg ? "-" : ""}${m}:${pad(s)}`;
}

function formatDistanceMiles(distance: number) {
  return distance.toFixed(2).replace(/\.00$/, "");
}

function formatDistanceKm(distanceMiles: number) {
  return (distanceMiles * KM_PER_MILE).toFixed(2).replace(/\.00$/, "");
}

function formatCourseMark(distance: number) {
  return distance.toFixed(2);
}

function timeStringToDate(timeStr: string) {
  const now = new Date();
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 0, mm || 0, 0);
}

function addSeconds(date: Date, seconds: number) {
  const d = new Date(date);
  d.setSeconds(d.getSeconds() + seconds);
  return d;
}

function formatClock(dt: Date) {
  const h = dt.getHours();
  const m = dt.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${pad(m)} ${ampm}`;
}

function makeMilesArray(distanceMiles: number) {
  const fullMiles = Math.floor(distanceMiles);
  const arr: number[] = [];
  for (let m = 1; m <= fullMiles; m++) arr.push(m);
  if (Math.abs(distanceMiles - fullMiles) > 1e-9) arr.push(distanceMiles);
  return arr;
}

function interpElevation(keys: CourseDef["elevationKeys"], mile: number) {
  if (keys.length === 0) return 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (mile >= a.mile && mile <= b.mile) {
      const t = (mile - a.mile) / Math.max(1e-9, b.mile - a.mile);
      return a.elev + t * (b.elev - a.elev);
    }
  }
  return keys[keys.length - 1].elev;
}

function paceWithAdj(
  baseSecPerMile: number,
  currentMile: number,
  segments: Array<SegmentDef & { pct?: number }>
) {
  const seg =
    segments.find((s) => currentMile >= s.startMile && currentMile <= s.endMile) ??
    segments[segments.length - 1];
  const adjPct = seg?.pct || 0;
  return baseSecPerMile * (1 + adjPct / 100);
}

function parseMilesInput(value: string, maxDistance: number) {
  return value
    .split(/[^0-9.]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0 && n <= maxDistance);
}

function within(x: number, y: number, tolerance = 0.05) {
  return Math.abs(x - y) <= tolerance;
}

function getOverlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function buildWalkWindows(distanceMiles: number, everyMiles: number) {
  if (!Number.isFinite(everyMiles) || everyMiles <= 0) return [] as WalkWindow[];

  const windows: WalkWindow[] = [];
  for (let start = everyMiles; start < distanceMiles; start += everyMiles) {
    const end = Math.min(distanceMiles, start + WALK_BREAK_DISTANCE);
    if (end > start) windows.push({ start, end });
  }
  return windows;
}

function buildTimingMats(distanceMiles: number) {
  const mats: number[] = [];
  for (let km = 5; km / KM_PER_MILE < distanceMiles - 0.05; km += 5) {
    mats.push(Number((km / KM_PER_MILE).toFixed(1)));
  }
  return mats;
}

function buildDefaultCrewMiles(distanceMiles: number) {
  const candidates = [distanceMiles * 0.3, distanceMiles * 0.6, distanceMiles * 0.85]
    .map((v) => Number(v.toFixed(1)))
    .filter((v, idx, arr) => v > 0 && v < distanceMiles && arr.indexOf(v) === idx);
  return candidates;
}

function createGenericCourse(slug: string, name: string, distanceMiles: number, note?: string): CourseDef {
  const safeDistance = Math.max(0.25, Number.isFinite(distanceMiles) ? distanceMiles : 13.1);
  const third = safeDistance / 3;
  const twoThirds = (2 * safeDistance) / 3;
  return {
    slug,
    name,
    distanceMiles: safeDistance,
    defaultStartTime: "08:00",
    defaultGoalPace: "9:00",
    defaultCrewMiles: buildDefaultCrewMiles(safeDistance),
    timingMats: buildTimingMats(safeDistance),
    segments: [
      { name: "Opening", startMile: 0, endMile: Number(third.toFixed(2)) },
      {
        name: "Middle",
        startMile: Number(third.toFixed(2)),
        endMile: Number(twoThirds.toFixed(2)),
      },
      {
        name: "Closing",
        startMile: Number(twoThirds.toFixed(2)),
        endMile: Number(safeDistance.toFixed(2)),
      },
    ],
    elevationKeys: [
      { mile: 0, elev: 0 },
      { mile: Number((safeDistance / 2).toFixed(2)), elev: 0 },
      { mile: Number(safeDistance.toFixed(2)), elev: 0 },
    ],
    note: note ?? "Generic distance mode for quick pacing experiments.",
  };
}

function toCSV(rows: Array<Array<string | number>>) {
  const processVal = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  return rows.map((r) => r.map(processVal).join(",")).join("\n");
}

function downloadCSV(filename: string, rows: Array<Array<string | number>>) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function defaultSegmentAdjustments(course: CourseDef) {
  return course.segments.map((segment) => ({
    name: segment.name,
    pct: segment.defaultAdjPct ?? 0,
  }));
}

const BUILTIN_COURSES: CourseDef[] = [
  {
    slug: "nyc",
    name: "New York City Marathon",
    distanceMiles: 26.2,
    defaultStartTime: "09:10",
    defaultGoalPace: "9:00",
    defaultCrewMiles: [8, 12, 14, 16],
    timingMats: [3.1, 6.2, 9.3, 12.4, 15.5, 18.6, 21.7, 24.8],
    segments: [
      { name: "Start & Verrazzano", startMile: 0, endMile: 2 },
      { name: "Brooklyn & Queens", startMile: 2, endMile: 15 },
      { name: "Queensboro Bridge", startMile: 15, endMile: 16.5 },
      { name: "1st Ave & Bronx", startMile: 16.5, endMile: 21 },
      { name: "5th Ave & Central Park", startMile: 21, endMile: 26.2 },
    ],
    elevationKeys: [
      { mile: 0, elev: 10 },
      { mile: 1, elev: 220 },
      { mile: 2, elev: 20 },
      { mile: 8, elev: 40 },
      { mile: 13.1, elev: 50 },
      { mile: 15, elev: 40 },
      { mile: 15.8, elev: 130 },
      { mile: 16.5, elev: 45 },
      { mile: 20, elev: 60 },
      { mile: 23.5, elev: 100 },
      { mile: 25, elev: 80 },
      { mile: 26.2, elev: 65 },
    ],
    note: "Big bridge early, Queensboro sting, then the 5th Ave grind.",
  },
  {
    slug: "chicago",
    name: "Chicago Marathon",
    distanceMiles: 26.2,
    defaultStartTime: "07:30",
    defaultGoalPace: "9:00",
    defaultCrewMiles: [5, 13, 18, 22],
    timingMats: [3.1, 6.2, 9.3, 12.4, 15.5, 18.6, 21.7, 24.8],
    segments: [
      { name: "Downtown Start", startMile: 0, endMile: 4 },
      { name: "North Side", startMile: 4, endMile: 10 },
      { name: "West Loop", startMile: 10, endMile: 17 },
      { name: "South Side", startMile: 17, endMile: 22 },
      { name: "Michigan Ave Finish", startMile: 22, endMile: 26.2 },
    ],
    elevationKeys: [
      { mile: 0, elev: 595 },
      { mile: 3, elev: 600 },
      { mile: 8, elev: 602 },
      { mile: 13.1, elev: 598 },
      { mile: 18, elev: 600 },
      { mile: 23, elev: 603 },
      { mile: 26.2, elev: 600 },
    ],
    note: "Fast and flat — ideal for even splits.",
  },
  {
    slug: "berlin",
    name: "Berlin Marathon",
    distanceMiles: 26.2,
    defaultStartTime: "09:15",
    defaultGoalPace: "9:00",
    defaultCrewMiles: [6, 13, 20, 24],
    timingMats: [3.1, 6.2, 9.3, 12.4, 15.5, 18.6, 21.7, 24.8],
    segments: [
      { name: "Tiergarten Start", startMile: 0, endMile: 5 },
      { name: "Central Berlin", startMile: 5, endMile: 13.1 },
      { name: "East & South", startMile: 13.1, endMile: 21 },
      { name: "Final Run-In", startMile: 21, endMile: 26.2 },
    ],
    elevationKeys: [
      { mile: 0, elev: 115 },
      { mile: 5, elev: 118 },
      { mile: 13.1, elev: 116 },
      { mile: 20, elev: 117 },
      { mile: 26.2, elev: 114 },
    ],
    note: "Another very flat course — great for rhythm and negative splits.",
  },
  {
    slug: "london",
    name: "London Marathon",
    distanceMiles: 26.2,
    defaultStartTime: "10:00",
    defaultGoalPace: "9:00",
    defaultCrewMiles: [7, 12, 18, 24],
    timingMats: [3.1, 6.2, 9.3, 12.4, 15.5, 18.6, 21.7, 24.8],
    segments: [
      { name: "Greenwich & Woolwich", startMile: 0, endMile: 6 },
      { name: "Canary Wharf Approach", startMile: 6, endMile: 14 },
      { name: "Docklands & East", startMile: 14, endMile: 20 },
      { name: "Embankment to Finish", startMile: 20, endMile: 26.2 },
    ],
    elevationKeys: [
      { mile: 0, elev: 35 },
      { mile: 6, elev: 28 },
      { mile: 14, elev: 24 },
      { mile: 20, elev: 18 },
      { mile: 26.2, elev: 22 },
    ],
    note: "Fast, spectator-heavy, and mostly flat.",
  },
  {
    slug: "boston",
    name: "Boston Marathon",
    distanceMiles: 26.2,
    defaultStartTime: "10:00",
    defaultGoalPace: "9:00",
    defaultCrewMiles: [6, 13, 20, 24],
    timingMats: [3.1, 6.2, 9.3, 12.4, 15.5, 18.6, 21.7, 24.8],
    segments: [
      { name: "Hopkinton Descent", startMile: 0, endMile: 6 },
      { name: "Framingham to Wellesley", startMile: 6, endMile: 13.1 },
      { name: "Newton Hills", startMile: 13.1, endMile: 21 },
      { name: "BC to Boylston", startMile: 21, endMile: 26.2 },
    ],
    elevationKeys: [
      { mile: 0, elev: 463 },
      { mile: 6, elev: 250 },
      { mile: 13.1, elev: 180 },
      { mile: 17, elev: 300 },
      { mile: 20.5, elev: 236 },
      { mile: 26.2, elev: 15 },
    ],
    note: "Net downhill, but the Newton Hills punish bad pacing.",
  },
  createGenericCourse(
    "half",
    "Generic Half Marathon",
    13.1,
    "Generic half marathon mode for quick testing and pacing.",
  ),
  createGenericCourse("custom", "Custom Distance", 10, "Set any distance and use a generic flat profile."),
];

const COURSE_MAP: Record<string, CourseDef> = Object.fromEntries(
  BUILTIN_COURSES.map((course) => [course.slug, course])
);

const INITIAL_COURSE = COURSE_MAP.nyc;

export default function PacePlanner() {
  const [courseSlug, setCourseSlug] = useState<string>("nyc");
  const [customDistance, setCustomDistance] = useState("13.1");

  const customDistanceMiles = useMemo(() => {
    const parsed = Number(customDistance);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 13.1;
  }, [customDistance]);

  const course = useMemo(() => {
    if (courseSlug === "custom") {
      return createGenericCourse(
        "custom",
        `Custom ${formatDistanceMiles(customDistanceMiles)} mi`,
        customDistanceMiles,
        "Generic flat profile for any custom race distance."
      );
    }
    return COURSE_MAP[courseSlug] ?? INITIAL_COURSE;
  }, [courseSlug, customDistanceMiles]);

  const [mode, setMode] = useState<PlannerMode>("pace");
  const [unitsMiles, setUnitsMiles] = useState(true);
  const [goalPace, setGoalPace] = useState(INITIAL_COURSE.defaultGoalPace);
  const [goalTime, setGoalTime] = useState("3:56:00");
  const [startTime, setStartTime] = useState(INITIAL_COURSE.defaultStartTime);
  const [gelEveryMin, setGelEveryMin] = useState(45);
  const [waterEveryMin, setWaterEveryMin] = useState(30);
  const [segAdj, setSegAdj] = useState<SegmentAdjustment[]>(defaultSegmentAdjustments(INITIAL_COURSE));
  const [crewMilesStr, setCrewMilesStr] = useState(INITIAL_COURSE.defaultCrewMiles.join(","));
  const [enableWalkBreaks, setEnableWalkBreaks] = useState(false);
  const [walkPace, setWalkPace] = useState("13:30");
  const [walkEveryMiles, setWalkEveryMiles] = useState("3");

  const milesArray = useMemo(() => makeMilesArray(course.distanceMiles), [course.distanceMiles]);

  const crewMiles = useMemo(
    () => parseMilesInput(crewMilesStr, course.distanceMiles),
    [crewMilesStr, course.distanceMiles]
  );

  const walkIntervalMiles = useMemo(() => {
    const parsed = Number(walkEveryMiles);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [walkEveryMiles]);

  const walkWindows = useMemo(
    () => (enableWalkBreaks ? buildWalkWindows(course.distanceMiles, walkIntervalMiles) : []),
    [enableWalkBreaks, course.distanceMiles, walkIntervalMiles]
  );

  const segmentDefs = useMemo<Array<SegmentDef & { pct?: number }>>(
    () => course.segments.map((seg, i) => ({ ...seg, pct: segAdj[i]?.pct || 0 })),
    [course, segAdj]
  );

  const baseSecPerMile = useMemo(() => {
    if (mode === "pace") return hhmmssToSeconds(goalPace);
    return hhmmssToSeconds(goalTime) / course.distanceMiles;
  }, [mode, goalPace, goalTime, course.distanceMiles]);

  const planner = useMemo<PlannerComputation>(() => {
    const rows: RowData[] = [];
    const rawBaselineSplits: number[] = [];
    const rawRunSplits: number[] = [];
    const rawWalkSplits: number[] = [];
    const walkNotes: string[] = [];
    let previousMark = 0;
    let totalWalkDistance = 0;

    const walkPaceSecPerMile = hhmmssToSeconds(walkPace);

    for (const mileVal of milesArray) {
      const splitStart = previousMark;
      const splitEnd = mileVal;
      const distance = splitEnd - splitStart;
      previousMark = mileVal;

      const runPaceSecPerMile = paceWithAdj(baseSecPerMile, mileVal, segmentDefs);
      const baselineSplit = runPaceSecPerMile * distance;
      rawBaselineSplits.push(baselineSplit);

      let runSplitSec = baselineSplit;
      let walkSplitSec = 0;
      let walkNote = "";

      if (enableWalkBreaks && distance > 0) {
        const overlappingWindows = walkWindows.filter(
          (window) => getOverlap(splitStart, splitEnd, window.start, window.end) > 0
        );

        if (overlappingWindows.length > 0) {
          const walkDistance = overlappingWindows.reduce(
            (sum, window) => sum + getOverlap(splitStart, splitEnd, window.start, window.end),
            0
          );
          const runDistance = Math.max(0, distance - walkDistance);

          runSplitSec = runPaceSecPerMile * runDistance;
          walkSplitSec = walkPaceSecPerMile * walkDistance;
          totalWalkDistance += walkDistance;
          walkNote = overlappingWindows
            .map((window) => `Walk ${formatCourseMark(window.start)}–${formatCourseMark(window.end)}`)
            .join(", ");
        }
      }

      rawRunSplits.push(runSplitSec);
      rawWalkSplits.push(walkSplitSec);
      walkNotes.push(walkNote);
    }

    const totalRawBaseline = rawBaselineSplits.reduce((a, b) => a + b, 0);
    const totalRawRunSum = rawRunSplits.reduce((a, b) => a + b, 0);
    const totalWalkTimeSec = rawWalkSplits.reduce((a, b) => a + b, 0);

    // In time mode: keep walk pace fixed and only scale the run portions to hit the goal time.
    // In pace mode: run pace is taken as-is (scale = 1).
    let runScale: number;
    if (mode === "time") {
      const goalTimeSec = hhmmssToSeconds(goalTime);
      runScale = totalRawRunSum > 0 ? (goalTimeSec - totalWalkTimeSec) / totalRawRunSum : 1;
    } else {
      runScale = 1;
    }

    const startDt = timeStringToDate(startTime);
    const gelInt = Math.max(0, gelEveryMin) * 60;
    const waterInt = Math.max(0, waterEveryMin) * 60;
    let nextGelAt = gelInt || Infinity;
    let nextWaterAt = waterInt || Infinity;
    let cumulative = 0;
    let previousMile = 0;

    milesArray.forEach((mileVal, idx) => {
      const distance = mileVal - previousMile;
      previousMile = mileVal;

      const splitSec = rawRunSplits[idx] * runScale + rawWalkSplits[idx];
      cumulative += splitSec;

      let gel: "" | "Gel" = "";
      let water: "" | "Water" = "";
      while (cumulative >= nextGelAt) {
        gel = "Gel";
        nextGelAt += gelInt || Infinity;
      }
      while (cumulative >= nextWaterAt) {
        water = "Water";
        nextWaterAt += waterInt || Infinity;
      }

      const segName = segmentDefs.find((s) => mileVal >= s.startMile && mileVal <= s.endMile)?.name;
      const crew = crewMiles.some((m) => within(mileVal, m)) ? "Crew" : "";
      const mat = course.timingMats.some((m) => within(mileVal, m)) ? "Mat" : "";

      rows.push({
        idx,
        mile: mileVal,
        km: mileVal * KM_PER_MILE,
        segName,
        pace: secondsToMS(splitSec / distance),
        split: secondsToHMS(splitSec),
        cumulative: secondsToHMS(cumulative),
        clock: formatClock(addSeconds(startDt, cumulative)),
        gel,
        water,
        crew,
        mat,
        walk: walkNotes[idx],
        yPaceSec: splitSec / distance,
      });
    });

    const actualElapsedSec = totalRawRunSum * runScale + totalWalkTimeSec;
    const baselineElapsedSec = totalRawBaseline * runScale;
    const addedWalkTimeSec = actualElapsedSec - baselineElapsedSec;

    return {
      rows,
      addedWalkTimeSec,
      totalWalkDistance,
      walkBreakCount: walkWindows.length,
      actualElapsedSec,
      baselineElapsedSec,
    };
  }, [
    milesArray,
    baseSecPerMile,
    segmentDefs,
    goalTime,
    mode,
    startTime,
    gelEveryMin,
    waterEveryMin,
    crewMiles,
    course.timingMats,
    enableWalkBreaks,
    walkWindows,
    walkPace,
  ]);

  const chartData = useMemo<ChartPoint[]>(
    () =>
      planner.rows.map((d) => ({
        name: d.mile,
        paceSec: Math.round(d.yPaceSec),
        elev: Math.round(interpElevation(course.elevationKeys, d.mile)),
      })),
    [planner.rows, course.elevationKeys]
  );

  const projectedFinishClock = useMemo(
    () => formatClock(addSeconds(timeStringToDate(startTime), planner.actualElapsedSec)),
    [startTime, planner.actualElapsedSec]
  );

  const effectiveAvgPace = useMemo(
    () => secondsToMS(planner.actualElapsedSec / course.distanceMiles),
    [planner.actualElapsedSec, course.distanceMiles]
  );

  function resetForCourse(nextCourse: CourseDef) {
    setGoalPace(nextCourse.defaultGoalPace);
    setStartTime(nextCourse.defaultStartTime);
    setSegAdj(defaultSegmentAdjustments(nextCourse));
    setCrewMilesStr(nextCourse.defaultCrewMiles.join(","));
    setMode("pace");
    setUnitsMiles(true);
    setGoalTime(nextCourse.distanceMiles === 13.1 ? "1:58:00" : "3:56:00");
    setGelEveryMin(45);
    setWaterEveryMin(30);
    setEnableWalkBreaks(false);
    setWalkPace("13:30");
    setWalkEveryMiles("3");
  }

  function exportCSV() {
    const header = [
      "Course",
      "Mile",
      "Kilometer",
      "Segment",
      "Pace (/mi)",
      "Split",
      "Cumulative",
      "On-Course Clock",
      "Notes",
    ];
    const rows = planner.rows.map((r) => [
      course.name,
      r.mile,
      r.km.toFixed(1),
      r.segName || "",
      r.pace,
      r.split,
      r.cumulative,
      r.clock,
      [r.gel, r.water, r.crew, r.mat, r.walk].filter(Boolean).join(" "),
    ]);
    downloadCSV(`${course.slug}-pace-chart.csv`, [header, ...rows]);
  }

  return (
    <div className="w-full min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Marathon Pace Planner</h1>
            <p className="mt-1 text-sm text-gray-600">Multi-course race planning for nonplus.ai</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4" /> Optional: set actual wave/corral start time
          </div>
        </header>

        <Card className="shadow-sm">
          <CardContent className="space-y-6 p-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Race / Course</Label>
                <Select
                  value={courseSlug}
                  onValueChange={(value) => {
                    const nextCourse =
                      value === "custom"
                        ? createGenericCourse(
                            "custom",
                            `Custom ${formatDistanceMiles(customDistanceMiles)} mi`,
                            customDistanceMiles,
                            "Generic flat profile for any custom race distance."
                          )
                        : COURSE_MAP[value] ?? INITIAL_COURSE;
                    setCourseSlug(value);
                    resetForCourse(nextCourse);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN_COURSES.map((entry) => (
                      <SelectItem key={entry.slug} value={entry.slug}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {course.note ? (
                  <div className="flex items-start gap-2 text-xs text-gray-500">
                    <MapPinned className="mt-0.5 h-3.5 w-3.5" />
                    <span>{course.note}</span>
                  </div>
                ) : null}
              </div>

              {courseSlug === "custom" ? (
                <div className="space-y-2">
                  <Label>Custom distance (miles)</Label>
                  <Input
                    value={customDistance}
                    onChange={(e) => setCustomDistance(e.target.value)}
                    placeholder="e.g. 10, 13.1, 31.1"
                  />
                  <div className="text-xs text-gray-500">≈ {formatDistanceKm(customDistanceMiles)} km</div>
                </div>
              ) : (
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-xs text-gray-500">Distance</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{formatDistanceMiles(course.distanceMiles)} mi</div>
                  <div className="mt-1 text-xs text-gray-500">≈ {formatDistanceKm(course.distanceMiles)} km</div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm">Mode</Label>
                <div className="flex items-center gap-2">
                  <Button variant={mode === "pace" ? "default" : "secondary"} onClick={() => setMode("pace")}>
                    Goal Pace
                  </Button>
                  <Button variant={mode === "time" ? "default" : "secondary"} onClick={() => setMode("time")}>
                    Goal Time
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {mode === "pace" ? (
                <div className="space-y-2">
                  <Label>Goal Pace ({unitsMiles ? "/mile" : "/km"})</Label>
                  <Input
                    value={unitsMiles ? goalPace : secondsToMS(Math.round(hhmmssToSeconds(goalPace) / KM_PER_MILE))}
                    onChange={(e) => {
                      if (unitsMiles) {
                        setGoalPace(e.target.value);
                      } else {
                        const perKm = hhmmssToSeconds(e.target.value);
                        const perMile = perKm * KM_PER_MILE;
                        const m = Math.floor(perMile / 60);
                        const s = Math.round(perMile % 60);
                        setGoalPace(`${m}:${pad(s)}`);
                      }
                    }}
                    placeholder={unitsMiles ? "mm:ss per mile" : "mm:ss per km"}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Goal Finish Time</Label>
                  <Input value={goalTime} onChange={(e) => setGoalTime(e.target.value)} placeholder="hh:mm:ss" />
                </div>
              )}

              <div className="space-y-2">
                <Label>Start Time (24h, local)</Label>
                <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="HH:MM" />
              </div>

              <div className="flex items-center gap-3 self-end pb-1">
                <Switch id="units" checked={unitsMiles} onCheckedChange={setUnitsMiles} />
                <Label htmlFor="units">Use miles (off = km)</Label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-xs text-gray-500">Projected finish</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{secondsToHMS(planner.actualElapsedSec)}</div>
              </div>
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-xs text-gray-500">Finish clock</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{projectedFinishClock}</div>
              </div>
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-xs text-gray-500">Effective avg pace</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{effectiveAvgPace}/mi</div>
              </div>
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-xs text-gray-500">No-walk finish</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{secondsToHMS(planner.baselineElapsedSec)}</div>
                {enableWalkBreaks ? (
                  <div className="mt-1 text-xs text-gray-500">+{secondsToMS(planner.addedWalkTimeSec)} slower with walks</div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Gel every (minutes)</Label>
                <Input type="number" value={gelEveryMin} onChange={(e) => setGelEveryMin(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Water every (minutes)</Label>
                <Input type="number" value={waterEveryMin} onChange={(e) => setWaterEveryMin(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Crew miles</Label>
                <Input value={crewMilesStr} onChange={(e) => setCrewMilesStr(e.target.value)} placeholder="e.g. 4, 8, 12" />
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="flex items-center gap-3 self-end pb-1">
                  <Switch id="walk-breaks" checked={enableWalkBreaks} onCheckedChange={setEnableWalkBreaks} />
                  <Label htmlFor="walk-breaks">Enable 0.25 mi walk breaks</Label>
                </div>
                <div className="space-y-2">
                  <Label>Walk pace</Label>
                  <Input value={walkPace} onChange={(e) => setWalkPace(e.target.value)} placeholder="mm:ss" disabled={!enableWalkBreaks} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Walk every X miles (course distance)</Label>
                  <Input
                    value={walkEveryMiles}
                    onChange={(e) => setWalkEveryMiles(e.target.value)}
                    placeholder="e.g. 3"
                    disabled={!enableWalkBreaks}
                  />
                </div>
              </div>

              {enableWalkBreaks ? (
                <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-amber-50 p-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-gray-500">Walk breaks</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                      <Footprints className="h-4 w-4" /> {planner.walkBreakCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Total walking distance</div>
                    <div className="mt-1 text-sm font-medium">{formatDistanceMiles(planner.totalWalkDistance)} mi</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Added time vs no-walk plan</div>
                    <div className="mt-1 text-sm font-medium">+{secondsToMS(planner.addedWalkTimeSec)}</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="font-medium">Segment Adjustments (±% pace)</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {segmentDefs.map((seg, i) => (
                  <div key={seg.name} className="rounded-2xl border bg-white p-4">
                    <div className="mb-2 text-sm font-medium">{seg.name}</div>
                    <div className="flex items-center gap-3">
                      <Slider
                        value={[segAdj[i]?.pct || 0]}
                        onValueChange={([v]) => {
                          const next = [...segAdj];
                          next[i] = { name: seg.name, pct: Math.round(v) };
                          setSegAdj(next);
                        }}
                        min={-10}
                        max={10}
                        step={1}
                        className="w-full"
                      />
                      <div className="w-12 text-right text-sm tabular-nums">{segAdj[i]?.pct || 0}%</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">+% = slower / -% = faster</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Button onClick={exportCSV} className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
              <Button variant="secondary" onClick={() => resetForCourse(course)} className="gap-2"><RefreshCcw className="h-4 w-4" /> Reset</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">Pace & Elevation</div>
              <div className="text-sm text-gray-500">Elevation is approximate for planning only</div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickFormatter={(v) => String(v)} label={{ value: "Mile", position: "insideBottomRight", offset: -5 }} />
                  <YAxis yAxisId="left" tickFormatter={(v) => secondsToMS(v)} label={{ value: "Pace (mm:ss)", angle: -90, position: "insideLeft" }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: "Elevation (ft)", angle: 90, position: "insideRight" }} />
                  <Tooltip
                    formatter={(value: number | string, name: string) =>
                      name === "paceSec" ? secondsToMS(Number(value)) : `${value} ft`
                    }
                    labelFormatter={(label) => `Mile ${label}`}
                  />
                  {course.slug === "nyc" ? <ReferenceArea x1={15} x2={16.5} label="Queensboro" /> : null}
                  {crewMiles.map((m, i) => (
                    <ReferenceLine key={`crew-${m}-${i}`} x={m} strokeDasharray="4 4" label={{ value: `Crew @${m}`, position: "top" }} />
                  ))}
                  {course.timingMats.map((m) => (
                    <ReferenceLine key={`mat-${m}`} x={m} strokeDasharray="1 6" label={{ value: `${m}`, position: "bottom" }} />
                  ))}
                  <Line yAxisId="left" type="monotone" dataKey="paceSec" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="elev" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left">{unitsMiles ? "Mile" : "Kilometer"}</th>
                  <th className="px-4 py-2 text-left">Segment</th>
                  <th className="px-4 py-2 text-left">Split</th>
                  <th className="px-4 py-2 text-left">Pace {unitsMiles ? "/mi" : "/km"}</th>
                  <th className="px-4 py-2 text-left">Cumulative</th>
                  <th className="px-4 py-2 text-left">On-Course Clock</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {planner.rows.map((row) => (
                  <tr key={row.idx} className={`border-b ${row.mat ? "bg-yellow-50" : row.walk ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-2 tabular-nums">{unitsMiles ? row.mile : row.km.toFixed(1)}</td>
                    <td className="px-4 py-2">{row.segName}</td>
                    <td className="px-4 py-2 tabular-nums">{row.split}</td>
                    <td className="px-4 py-2 tabular-nums">{unitsMiles ? row.pace : secondsToMS(Math.round(hhmmssToSeconds(row.pace) / KM_PER_MILE))}</td>
                    <td className="px-4 py-2 tabular-nums">{row.cumulative}</td>
                    <td className="px-4 py-2 tabular-nums">{row.clock}</td>
                    <td className="px-4 py-2">{[row.gel, row.water, row.crew, row.mat, row.walk].filter(Boolean).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-4 text-sm text-gray-600">
            <div className="flex items-start gap-2">
              <Route className="mt-0.5 h-4 w-4" />
              <div>
                Half marathon and custom distance modes use a generic flat profile and dynamically generated 5K timing mats. Crew spots and goal defaults can still be edited after selection.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
