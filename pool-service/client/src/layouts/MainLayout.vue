<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>Pool Service</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- Phase 3: Route / Customers / Issues / More bottom navigation -->
    <q-footer bordered class="bg-white text-primary">
      <q-tabs dense no-caps active-color="primary" indicator-color="transparent" class="text-grey-7">
        <q-route-tab to="/" exact icon="checklist" label="Route" />
        <q-tab disable icon="people" label="Customers" />
        <q-tab disable icon="report_problem" label="Issues" />
        <q-tab disable icon="more_horiz" label="More" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
defineOptions({ name: 'MainLayout' });
</script>
