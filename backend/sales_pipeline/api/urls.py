from django.urls import path

from . import views as v

urlpatterns = [
    path("pipelines/", v.PipelineListView.as_view()),
    path("pipelines/<uuid:pk>/", v.PipelineDetailView.as_view()),
    path("pipelines/<uuid:pk>/stages/", v.PipelineStagesView.as_view()),
    path("pipelines/<uuid:pk>/stages/<str:key>/remove/", v.PipelineStageRemoveView.as_view()),
    path("pipelines/<uuid:pk>/import/", v.PipelineImportView.as_view()),
    path("pipelines/<uuid:pk>/samples/", v.PipelineSamplesView.as_view()),
    path("deals/", v.DealListView.as_view()),
    path("deals/<uuid:pk>/", v.DealDetailView.as_view()),
    path("deals/<uuid:pk>/move/", v.DealMoveView.as_view()),
    path("deals/<uuid:pk>/activities/", v.DealActivityView.as_view()),
    path("deals/<uuid:pk>/expansion/", v.DealExpansionView.as_view()),
    path("deals/<uuid:pk>/ai-draft/", v.DealAiDraftView.as_view()),
    path("tasks/", v.TaskListView.as_view()),
    path("tasks/<uuid:pk>/", v.TaskDetailView.as_view()),
    path("settings/", v.SettingsView.as_view()),
    path("users/", v.UserListView.as_view()),
    path("stage-tasks/", v.StageTaskListView.as_view()),
    path("stage-tasks/<uuid:pk>/", v.StageTaskDetailView.as_view()),
]
