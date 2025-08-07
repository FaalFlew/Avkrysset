// src/types/index.ts

export interface Task {
  id: string;
  title: string;
  start: string;
  duration: number;
  categoryId: string;
  templateId?: string;
}

export interface TaskTemplate {
  id: string;
  title: string;
  duration: number;
  categoryId: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}
