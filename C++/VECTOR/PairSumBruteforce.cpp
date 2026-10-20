#include<iostream>
#include<vector>
using namespace std;
//pairsum bruteforce approch..
vector<int> pairsum(vector<int> arr, int target){
  int size = arr.size();
  vector<int> ans;
  for (int i = 0; i<size; i++){
    for (int j = i+1; j<size; j++){
      if (arr[i] + arr[j] == target){
        ans.push_back(arr[i]);
        ans.push_back(arr[j]);
        return ans;
      }
    }
  }
  return ans;
}
int main (){
  vector<int> arr = {2, 7, 11, 15};
  int target = 9;

  vector<int> ans = pairsum(arr, target);
  for (int answer : ans){
    cout<<answer<<" ";
  }
  return 0;
}